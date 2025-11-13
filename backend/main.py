from fastapi import FastAPI, Depends, HTTPException, status, Cookie, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from typing import Optional
from datetime import datetime, timedelta
from database import connect_to_mongo, close_mongo_connection, get_database
from models import (
    UserCreate, UserLogin, UserResponse, Token,
    FriendRequestCreate, FriendRequestResponse, FriendResponse,
    SessionCreate, SessionUpdate, SessionResponse, SessionMember,
    SessionInvitationResponse, SessionRequestResponse, NotificationResponse
)
from auth import verify_password, get_password_hash, create_access_token, verify_token
from bson import ObjectId
from config import settings
import socketio
import httpx
import secrets
import base64
import urllib.parse

security = HTTPBearer(auto_error=False)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_to_mongo()
    yield
    # Shutdown
    await close_mongo_connection()

app = FastAPI(
    title="TuneTogether API",
    description="Backend API for TuneTogether social streaming platform",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # Vite default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',  # Allow all origins for Socket.IO
    logger=True,
    engineio_logger=True
)

# Store authenticated users: {sid: user_id}
authenticated_users = {}

async def jwt_auth_socket(sid, environ):
    """Extract and validate JWT token from query string or cookie"""
    import urllib.parse
    
    # Try to get token from query string
    query = environ.get('QUERY_STRING', '')
    token = None
    
    if 'token=' in query:
        # Parse query string properly (handles URL encoding)
        parsed_query = urllib.parse.parse_qs(query)
        if 'token' in parsed_query and len(parsed_query['token']) > 0:
            token = parsed_query['token'][0]
    
    # Optionally, get from cookie
    if not token:
        cookies = environ.get('HTTP_COOKIE', '')
        for c in cookies.split(';'):
            c = c.strip()
            if c.startswith('access_token='):
                token = c.split('=', 1)[1]
                break
    
    if not token:
        print(f"Socket connection rejected: No token found for sid={sid}")
        return None
    
    # Remove Bearer prefix if present
    if token.startswith('Bearer '):
        token = token.split(' ', 1)[1]
    
    try:
        # Decode and validate token using our verify_token function
        token_data = verify_token(token)
        if token_data is None:
            print(f"Socket connection rejected: Invalid token for sid={sid}")
            return None
        
        # Get user from database using email from token
        db = get_database()
        user = await db.users.find_one({"email": token_data.email})
        if not user:
            print(f"Socket connection rejected: User not found for email={token_data.email}")
            return None
        
        return {
            "user_id": str(user["_id"]),
            "username": user["username"],
            "email": user["email"]
        }
    except Exception as e:
        print(f"Socket connection error: {e}")
        import traceback
        traceback.print_exc()
        return None

@sio.event
async def connect(sid, environ):
    """Handle socket connection with JWT authentication"""
    try:
        user_info = await jwt_auth_socket(sid, environ)
        if not user_info:
            print(f"Socket connection rejected: Authentication failed for sid={sid}")
            return False
        
        # Store session info
        authenticated_users[sid] = user_info
        print(f"✅ Socket connected: sid={sid}, user_id={user_info['user_id']}, username={user_info['username']}")
        await sio.emit('connected', {'message': 'Successfully connected'}, room=sid)
        return True
    except Exception as e:
        print(f"Socket connect failed: {e}")
        import traceback
        traceback.print_exc()
        return False

@sio.event
async def disconnect(sid):
    """Handle socket disconnection"""
    user_info = authenticated_users.pop(sid, {})
    print(f"User {user_info.get('username', 'unknown')} disconnected: {sid}")

@sio.event
async def join_session(sid, data):
    """Join a session room"""
    if sid not in authenticated_users:
        await sio.emit('error', {'message': 'Not authenticated'}, room=sid)
        return
    
    session_id = data.get('session_id')
    if not session_id:
        await sio.emit('error', {'message': 'session_id required'}, room=sid)
        return
    
    # Verify user has access to session
    db = get_database()
    user_id = authenticated_users[sid]["user_id"]
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        await sio.emit('error', {'message': 'Session not found'}, room=sid)
        return
    
    # Check access based on privacy_type
    privacy_type = session.get("privacy_type", "public")
    if privacy_type == "private":
        is_host = session["host_id"] == user_id
        is_member = any(m["user_id"] == user_id for m in session.get("members", []))
        if not (is_host or is_member):
            await sio.emit('error', {'message': 'Access denied'}, room=sid)
            return
    elif privacy_type == "friends":
        is_host = session["host_id"] == user_id
        is_member = any(m["user_id"] == user_id for m in session.get("members", []))
        if not (is_host or is_member):
            # Check if user is a friend of the host
            friendships = await db.friends.find_one({
                "user_id": user_id,
                "friend_id": session["host_id"]
            })
            if not friendships:
                await sio.emit('error', {'message': 'Access denied'}, room=sid)
                return
    
    # Join room
    sio.enter_room(sid, f"session_{session_id}")
    await sio.emit('joined_session', {'session_id': session_id}, room=sid)
    
    # Notify others in the session
    await sio.emit('user_joined', {
        'user_id': user_id,
        'username': authenticated_users[sid]["username"]
    }, room=f"session_{session_id}", skip_sid=sid)

@sio.event
async def leave_session(sid, data):
    """Leave a session room"""
    if sid not in authenticated_users:
        return
    
    session_id = data.get('session_id')
    if not session_id:
        return
    
    user_id = authenticated_users[sid]["user_id"]
    
    # Leave room
    sio.leave_room(sid, f"session_{session_id}")
    await sio.emit('left_session', {'session_id': session_id}, room=sid)
    
    # Notify others in the session
    await sio.emit('user_left', {
        'user_id': user_id,
        'username': authenticated_users[sid]["username"]
    }, room=f"session_{session_id}", skip_sid=sid)

@sio.event
async def session_update(sid, data):
    """Update session state (host only)"""
    if sid not in authenticated_users:
        await sio.emit('error', {'message': 'Not authenticated'}, room=sid)
        return
    
    session_id = data.get('session_id')
    if not session_id:
        await sio.emit('error', {'message': 'session_id required'}, room=sid)
        return
    
    db = get_database()
    user_id = authenticated_users[sid]["user_id"]
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        await sio.emit('error', {'message': 'Session not found'}, room=sid)
        return
    
    # Only host can update
    if session["host_id"] != user_id:
        await sio.emit('error', {'message': 'Only host can update session'}, room=sid)
        return
    
    # Update session in database
    update_dict = {"updated_at": datetime.utcnow()}
    if 'is_playing' in data:
        update_dict["is_playing"] = data['is_playing']
    if 'position_ms' in data:
        update_dict["position_ms"] = data['position_ms']
    if 'track_id' in data:
        update_dict["track_id"] = data['track_id']
    if 'track_name' in data:
        update_dict["track_name"] = data['track_name']
    if 'track_artist' in data:
        update_dict["track_artist"] = data['track_artist']
    
    await db.sessions.update_one(
        {"_id": ObjectId(session_id)},
        {"$set": update_dict}
    )
    
    # Broadcast update to all session members
    await sio.emit('session_updated', {
        'session_id': session_id,
        'updates': data
    }, room=f"session_{session_id}")

@sio.on('chat:message')
async def chat_message(sid, data):
    """Handle chat messages in a session"""
    if sid not in authenticated_users:
        await sio.emit('error', {'message': 'Not authenticated'}, room=sid)
        return
    
    session_id = data.get('session_id')
    message = data.get('message')
    
    if not session_id or not message:
        await sio.emit('error', {'message': 'session_id and message required'}, room=sid)
        return
    
    # Verify user is in the session
    db = get_database()
    user_id = authenticated_users[sid]["user_id"]
    username = authenticated_users[sid]["username"]
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        await sio.emit('error', {'message': 'Session not found'}, room=sid)
        return
    
    # Check if user is a member or host
    is_host = session["host_id"] == user_id
    is_member = any(m["user_id"] == user_id for m in session.get("members", []))
    
    if not (is_host or is_member):
        await sio.emit('error', {'message': 'You are not a member of this session'}, room=sid)
        return
    
    # Store message in database
    message_doc = {
        "session_id": session_id,
        "user_id": user_id,
        "username": username,
        "message": message,
        "created_at": datetime.utcnow()
    }
    await db.chat_messages.insert_one(message_doc)
    
    # Broadcast message to all session members
    await sio.emit('chat:message', {
        'session_id': session_id,
        'user_id': user_id,
        'username': username,
        'message': message,
        'timestamp': datetime.utcnow().isoformat()
    }, room=f"session_{session_id}")

# Mount Socket.IO app in FastAPI
# Create socket app without FastAPI app first (matching working pattern)
# When mounted at /socket.io, the path prefix is stripped, so we use root path
socket_app = socketio.ASGIApp(sio, socketio_path="/")

# Mount the socket app in FastAPI at /socket.io
app.mount("/socket.io", socket_app)

async def get_current_user(
    token: Optional[str] = Cookie(None),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    token_query: Optional[str] = None
):
    """Get current authenticated user"""
    # Try to get token from query parameter first, then cookie, then Authorization header
    token_value = None
    
    # Check query parameter first
    if token_query:
        token_value = token_query
    # Check cookie (ensure it's a string, not a Cookie object)
    elif token and isinstance(token, str):
        token_value = token
    # Check Authorization header
    elif credentials and credentials.credentials:
        token_value = credentials.credentials
    
    if not token_value or not isinstance(token_value, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Remove Bearer prefix if present
    if token_value.startswith('Bearer '):
        token_value = token_value.split(' ', 1)[1]
    
    token_data = verify_token(token_value)
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    db = get_database()
    user = await db.users.find_one({"email": token_data.email})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    
    return user

@app.get("/")
async def root():
    return {"message": "TuneTogether API"}

@app.post("/api/auth/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def signup(user_data: UserCreate):
    """Create a new user account"""
    db = get_database()
    
    # Check if user already exists
    existing_user = await db.users.find_one({
        "$or": [
            {"email": user_data.email},
            {"username": user_data.username}
        ]
    })
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email or username already registered"
        )
    
    # Hash password and create user
    hashed_password = get_password_hash(user_data.password)
    user_doc = {
        "username": user_data.username,
        "email": user_data.email,
        "password": hashed_password,
        "created_at": datetime.utcnow()
    }
    
    result = await db.users.insert_one(user_doc)
    user_doc["id"] = str(result.inserted_id)
    user_doc.pop("password", None)
    user_doc.pop("_id", None)
    
    return UserResponse(**user_doc)

@app.post("/api/auth/login", response_model=Token)
async def login(user_data: UserLogin, response: Response):
    """Login and get access token"""
    db = get_database()
    
    # Find user by email
    user = await db.users.find_one({"email": user_data.email})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    # Verify password
    if not verify_password(user_data.password, user["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    # Create access token
    access_token_expires = timedelta(minutes=settings.jwt_access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": user["email"]}, expires_delta=access_token_expires
    )
    
    # Set httpOnly cookie
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
        max_age=settings.jwt_access_token_expire_minutes * 60
    )
    
    return Token(access_token=access_token, token_type="bearer")

@app.get("/api/auth/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """Get current user information"""
    return UserResponse(
        id=str(current_user["_id"]),
        username=current_user["username"],
        email=current_user["email"],
        created_at=current_user.get("created_at")
    )

@app.get("/api/users/search", response_model=list[UserResponse])
async def search_users(
    query: str,
    current_user: dict = Depends(get_current_user)
):
    """Search users by email or username"""
    if not query or len(query.strip()) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Query must be at least 2 characters"
        )
    
    db = get_database()
    query_lower = query.strip().lower()
    
    # Search by email or username (case-insensitive)
    users = await db.users.find({
        "$or": [
            {"email": {"$regex": query_lower, "$options": "i"}},
            {"username": {"$regex": query_lower, "$options": "i"}}
        ],
        "_id": {"$ne": current_user["_id"]}  # Exclude current user
    }).limit(10).to_list(length=10)
    
    result = []
    for user in users:
        result.append(UserResponse(
            id=str(user["_id"]),
            username=user["username"],
            email=user["email"],
            created_at=user.get("created_at")
        ))
    
    return result

@app.post("/api/auth/logout")
async def logout(response: Response):
    """Logout by clearing the access token cookie"""
    response.delete_cookie(key="access_token")
    return {"message": "Successfully logged out"}

# Friends endpoints
@app.post("/api/friends/request", response_model=FriendRequestResponse, status_code=status.HTTP_201_CREATED)
async def send_friend_request(
    request_data: FriendRequestCreate,
    current_user: dict = Depends(get_current_user)
):
    """Send a friend request to another user by ID, email, or username"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    # Find recipient by ID, email, or username
    recipient = None
    if request_data.recipient_id:
        recipient = await db.users.find_one({"_id": ObjectId(request_data.recipient_id)})
    elif request_data.recipient_email:
        recipient = await db.users.find_one({"email": request_data.recipient_email.lower()})
    elif request_data.recipient_username:
        recipient = await db.users.find_one({"username": {"$regex": f"^{request_data.recipient_username}$", "$options": "i"}})
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide recipient_id, recipient_email, or recipient_username"
        )
    
    if not recipient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    recipient_id = str(recipient["_id"])
    
    # Can't send request to yourself
    if current_user_id == recipient_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot send friend request to yourself"
        )
    
    # Check if request already exists
    existing_request = await db.friend_requests.find_one({
        "$or": [
            {"sender_id": current_user_id, "recipient_id": recipient_id},
            {"sender_id": recipient_id, "recipient_id": current_user_id}
        ]
    })
    
    if existing_request:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Friend request already exists"
        )
    
    # Check if already friends
    existing_friendship = await db.friends.find_one({
        "$or": [
            {"user_id": current_user_id, "friend_id": recipient_id},
            {"user_id": recipient_id, "friend_id": current_user_id}
        ]
    })
    
    if existing_friendship:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Users are already friends"
        )
    
    # Create friend request
    friend_request = {
        "sender_id": current_user_id,
        "recipient_id": recipient_id,
        "status": "pending",
        "created_at": datetime.utcnow()
    }
    
    result = await db.friend_requests.insert_one(friend_request)
    friend_request["id"] = str(result.inserted_id)
    friend_request.pop("_id", None)
    
    # Get sender and recipient info for response
    sender = current_user
    return FriendRequestResponse(
        id=friend_request["id"],
        sender_id=current_user_id,
        sender_username=sender["username"],
        sender_email=sender["email"],
        recipient_id=recipient_id,
        recipient_username=recipient["username"],
        recipient_email=recipient["email"],
        status=friend_request["status"],
        created_at=friend_request["created_at"]
    )

@app.get("/api/friends/requests", response_model=list[FriendRequestResponse])
async def get_friend_requests(current_user: dict = Depends(get_current_user)):
    """Get pending friend requests (sent and received)"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    requests = await db.friend_requests.find({
        "$or": [
            {"sender_id": current_user_id, "status": "pending"},
            {"recipient_id": current_user_id, "status": "pending"}
        ]
    }).to_list(length=100)
    
    result = []
    for req in requests:
        # Get sender and recipient user info
        sender = await db.users.find_one({"_id": ObjectId(req["sender_id"])})
        recipient = await db.users.find_one({"_id": ObjectId(req["recipient_id"])})
        
        if sender and recipient:
            result.append(FriendRequestResponse(
                id=str(req["_id"]),
                sender_id=req["sender_id"],
                sender_username=sender["username"],
                sender_email=sender["email"],
                recipient_id=req["recipient_id"],
                recipient_username=recipient["username"],
                recipient_email=recipient["email"],
                status=req["status"],
                created_at=req["created_at"]
            ))
    
    return result

@app.post("/api/friends/requests/{request_id}/accept", response_model=FriendResponse)
async def accept_friend_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Accept a friend request"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    # Find the friend request
    friend_request = await db.friend_requests.find_one({
        "_id": ObjectId(request_id),
        "recipient_id": current_user_id,
        "status": "pending"
    })
    
    if not friend_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Friend request not found"
        )
    
    sender_id = friend_request["sender_id"]
    
    # Update request status
    await db.friend_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {"status": "accepted"}}
    )
    
    # Create friendship in both directions
    await db.friends.insert_one({
        "user_id": current_user_id,
        "friend_id": sender_id,
        "created_at": datetime.utcnow()
    })
    
    await db.friends.insert_one({
        "user_id": sender_id,
        "friend_id": current_user_id,
        "created_at": datetime.utcnow()
    })
    
    # Get sender info
    sender = await db.users.find_one({"_id": ObjectId(sender_id)})
    return FriendResponse(
        id=str(sender["_id"]),
        username=sender["username"],
        email=sender["email"],
        created_at=sender.get("created_at")
    )

@app.post("/api/friends/requests/{request_id}/reject")
async def reject_friend_request(
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Reject a friend request"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    # Find and update the friend request
    result = await db.friend_requests.update_one(
        {
            "_id": ObjectId(request_id),
            "recipient_id": current_user_id,
            "status": "pending"
        },
        {"$set": {"status": "rejected"}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Friend request not found"
        )
    
    return {"message": "Friend request rejected"}

@app.get("/api/friends", response_model=list[FriendResponse])
async def get_friends(current_user: dict = Depends(get_current_user)):
    """Get list of friends"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    # Get all friendships where current user is involved
    friendships = await db.friends.find({"user_id": current_user_id}).to_list(length=100)
    
    friend_ids = [ObjectId(f["friend_id"]) for f in friendships]
    
    if not friend_ids:
        return []
    
    # Get friend user details
    friends = await db.users.find({"_id": {"$in": friend_ids}}).to_list(length=100)
    
    result = []
    for friend in friends:
        result.append(FriendResponse(
            id=str(friend["_id"]),
            username=friend["username"],
            email=friend["email"],
            created_at=friend.get("created_at")
        ))
    
    return result

@app.delete("/api/friends/{friend_id}")
async def remove_friend(
    friend_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Remove a friend"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    # Remove friendship in both directions
    await db.friends.delete_many({
        "$or": [
            {"user_id": current_user_id, "friend_id": friend_id},
            {"user_id": friend_id, "friend_id": current_user_id}
        ]
    })
    
    # Also delete any related friend requests
    await db.friend_requests.delete_many({
        "$or": [
            {"sender_id": current_user_id, "recipient_id": friend_id},
            {"sender_id": friend_id, "recipient_id": current_user_id}
        ]
    })
    
    return {"message": "Friend removed successfully"}

# Session endpoints
@app.post("/api/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    session_data: SessionCreate,
    current_user: dict = Depends(get_current_user)
):
    """Create a new listening session"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session_doc = {
        "name": session_data.name,
        "description": session_data.description,
        "host_id": current_user_id,
        "host_username": current_user["username"],
        "platform": session_data.platform,
        "track_id": session_data.track_id,
        "track_name": session_data.track_name,
        "track_artist": session_data.track_artist,
        "is_playing": False,
        "position_ms": 0,
        "privacy_type": session_data.privacy_type,
        "members": [{
            "user_id": current_user_id,
            "username": current_user["username"],
            "joined_at": datetime.utcnow()
        }],
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }
    
    result = await db.sessions.insert_one(session_doc)
    session_doc["id"] = str(result.inserted_id)
    session_doc.pop("_id", None)
    
    # Convert members to SessionMember objects
    session_doc["members"] = [SessionMember(**m) for m in session_doc["members"]]
    
    return SessionResponse(**session_doc)

@app.get("/api/sessions", response_model=list[SessionResponse])
async def list_sessions(
    current_user: dict = Depends(get_current_user),
    private_only: bool = False
):
    """List all sessions filtered by privacy type and friend relationships"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    # Get user's friends list
    friendships = await db.friends.find({"user_id": current_user_id}).to_list(length=100)
    friend_ids = [f["friend_id"] for f in friendships]
    
    # Build query based on privacy type
    query_conditions = []
    
    # Always show sessions where user is host or member
    query_conditions.append({"host_id": current_user_id})
    query_conditions.append({"members.user_id": current_user_id})
    
    # Show public sessions
    query_conditions.append({"privacy_type": "public"})
    
    # Show friends-only sessions if user is a friend of the host
    if friend_ids:
        query_conditions.append({
            "privacy_type": "friends",
            "host_id": {"$in": friend_ids}
        })
    
    query = {"$or": query_conditions}
    
    if private_only:
        # Only show sessions where user is host or member
        query = {
            "$or": [
                {"host_id": current_user_id},
                {"members.user_id": current_user_id}
            ]
        }
    
    sessions = await db.sessions.find(query).sort("created_at", -1).to_list(length=100)
    
    result = []
    for session in sessions:
        # Ensure privacy_type exists (for backward compatibility)
        if "privacy_type" not in session:
            session["privacy_type"] = "public" if not session.get("is_private", False) else "private"
        
        session["id"] = str(session["_id"])
        session.pop("_id", None)
        # Remove is_private if it exists (for backward compatibility)
        session.pop("is_private", None)
        session["members"] = [SessionMember(**m) for m in session["members"]]
        result.append(SessionResponse(**session))
    
    return result

@app.get("/api/sessions/invitations", response_model=list[SessionInvitationResponse])
async def get_session_invitations(
    current_user: dict = Depends(get_current_user)
):
    """Get pending session invitations for current user"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    invitations = await db.session_invitations.find({
        "invitee_id": current_user_id,
        "status": "pending"
    }).sort("created_at", -1).to_list(length=100)
    
    result = []
    for inv in invitations:
        # Get session info
        session = await db.sessions.find_one({"_id": ObjectId(inv["session_id"])})
        if not session:
            continue
        
        # Get inviter info
        inviter = await db.users.find_one({"_id": ObjectId(inv["inviter_id"])})
        if not inviter:
            continue
        
        inv["id"] = str(inv["_id"])
        inv.pop("_id", None)
        inv["session_name"] = session["name"]
        inv["inviter_username"] = inviter["username"]
        result.append(SessionInvitationResponse(**inv))
    
    return result

@app.get("/api/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get a specific session"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Check if user has access based on privacy_type
    privacy_type = session.get("privacy_type", "public")
    if privacy_type == "private":
        is_host = session["host_id"] == current_user_id
        is_member = any(m["user_id"] == current_user_id for m in session.get("members", []))
        if not (is_host or is_member):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to private session"
            )
    elif privacy_type == "friends":
        is_host = session["host_id"] == current_user_id
        is_member = any(m["user_id"] == current_user_id for m in session.get("members", []))
        if not (is_host or is_member):
            # Check if user is a friend of the host
            friendship = await db.friends.find_one({
                "user_id": current_user_id,
                "friend_id": session["host_id"]
            })
            if not friendship:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied. Only friends of the host can join."
                )
    
    # Ensure privacy_type exists (for backward compatibility)
    if "privacy_type" not in session:
        session["privacy_type"] = "public" if not session.get("is_private", False) else "private"
    
    session["id"] = str(session["_id"])
    session.pop("_id", None)
    session.pop("is_private", None)  # Remove is_private if it exists
    session["members"] = [SessionMember(**m) for m in session.get("members", [])]
    
    return SessionResponse(**session)

@app.get("/api/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    limit: int = 100
):
    """Get chat messages for a session"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Check if user has access
    is_host = session["host_id"] == current_user_id
    is_member = any(m["user_id"] == current_user_id for m in session.get("members", []))
    
    if not (is_host or is_member):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Get messages from database
    messages = await db.chat_messages.find({
        "session_id": session_id
    }).sort("created_at", 1).limit(limit).to_list(length=limit)
    
    result = []
    for msg in messages:
        result.append({
            "id": str(msg["_id"]),
            "session_id": msg["session_id"],
            "user_id": msg["user_id"],
            "username": msg["username"],
            "message": msg["message"],
            "timestamp": msg["created_at"].isoformat() if isinstance(msg["created_at"], datetime) else msg["created_at"]
        })
    
    return result

@app.post("/api/sessions/{session_id}/join", response_model=SessionResponse)
async def join_session(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Join a session"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Check if user has access based on privacy_type
    privacy_type = session.get("privacy_type", "public")
    if privacy_type == "private":
        is_host = session["host_id"] == current_user_id
        is_member = any(m["user_id"] == current_user_id for m in session.get("members", []))
        if not (is_host or is_member):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied to private session"
            )
    elif privacy_type == "friends":
        is_host = session["host_id"] == current_user_id
        is_member = any(m["user_id"] == current_user_id for m in session.get("members", []))
        if not (is_host or is_member):
            # Check if user is a friend of the host
            friendship = await db.friends.find_one({
                "user_id": current_user_id,
                "friend_id": session["host_id"]
            })
            if not friendship:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied. Only friends of the host can join."
                )
    
    # Check if already a member
    is_member = any(m["user_id"] == current_user_id for m in session.get("members", []))
    if is_member:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already a member of this session"
        )
    
    # Add user to members
    await db.sessions.update_one(
        {"_id": ObjectId(session_id)},
        {
            "$push": {
                "members": {
                    "user_id": current_user_id,
                    "username": current_user["username"],
                    "joined_at": datetime.utcnow()
                }
            },
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    
    # Return updated session
    updated_session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    # Ensure privacy_type exists (for backward compatibility)
    if "privacy_type" not in updated_session:
        updated_session["privacy_type"] = "public" if not updated_session.get("is_private", False) else "private"
    updated_session["id"] = str(updated_session["_id"])
    updated_session.pop("_id", None)
    updated_session.pop("is_private", None)  # Remove is_private if it exists
    updated_session["members"] = [SessionMember(**m) for m in updated_session.get("members", [])]
    
    return SessionResponse(**updated_session)

@app.post("/api/sessions/{session_id}/request", response_model=SessionRequestResponse, status_code=status.HTTP_201_CREATED)
async def request_to_join_session(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Request to join a session (for public/friends sessions)"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Only allow requests for public or friends sessions
    privacy_type = session.get("privacy_type", "public")
    if privacy_type == "private":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot request to join private sessions. You must be invited."
        )
    
    # Can't request if you're the host
    if session["host_id"] == current_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are the host of this session"
        )
    
    # Check if already a member
    is_member = any(m["user_id"] == current_user_id for m in session.get("members", []))
    if is_member:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are already a member of this session"
        )
    
    # Check if there's already a pending request
    existing_request = await db.session_requests.find_one({
        "session_id": session_id,
        "requester_id": current_user_id,
        "status": "pending"
    })
    
    if existing_request:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request already sent"
        )
    
    # For friends sessions, check if user is a friend of the host
    if privacy_type == "friends":
        friendship = await db.friends.find_one({
            "$or": [
                {"user_id": current_user_id, "friend_id": session["host_id"]},
                {"user_id": session["host_id"], "friend_id": current_user_id}
            ]
        })
        if not friendship:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You must be friends with the host to request to join"
            )
    
    # Create request
    request = {
        "session_id": session_id,
        "requester_id": current_user_id,
        "status": "pending",
        "created_at": datetime.utcnow()
    }
    
    result = await db.session_requests.insert_one(request)
    request["id"] = str(result.inserted_id)
    request.pop("_id", None)
    request["requester_username"] = current_user["username"]
    
    # Send real-time notification to the host if they're connected
    host_sids = [sid for sid, user_info in authenticated_users.items() if user_info["user_id"] == session["host_id"]]
    for sid in host_sids:
        await sio.emit('session_request', {
            'request_id': request["id"],
            'session_id': session_id,
            'session_name': session["name"],
            'requester_username': current_user["username"],
            'requester_id': current_user_id
        }, room=sid)
    
    return SessionRequestResponse(**request)

@app.get("/api/sessions/requests/{session_id}", response_model=list[SessionRequestResponse])
async def get_session_requests(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get pending requests for a session (host only)"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Only host can see requests
    if session["host_id"] != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the host can view session requests"
        )
    
    requests = await db.session_requests.find({
        "session_id": session_id,
        "status": "pending"
    }).sort("created_at", -1).to_list(length=100)
    
    result = []
    for req in requests:
        # Get requester info
        requester = await db.users.find_one({"_id": ObjectId(req["requester_id"])})
        if not requester:
            continue
        
        req["id"] = str(req["_id"])
        req.pop("_id", None)
        req["requester_username"] = requester["username"]
        result.append(SessionRequestResponse(**req))
    
    return result

@app.post("/api/sessions/requests/{session_id}/{request_id}/accept", response_model=SessionResponse)
async def accept_session_request(
    session_id: str,
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Accept a session request (host only)"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Only host can accept
    if session["host_id"] != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the host can accept requests"
        )
    
    request = await db.session_requests.find_one({
        "_id": ObjectId(request_id),
        "session_id": session_id,
        "status": "pending"
    })
    
    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Request not found or already processed"
        )
    
    requester_id = request["requester_id"]
    
    # Check if already a member
    is_member = any(m["user_id"] == requester_id for m in session.get("members", []))
    if is_member:
        # Update request status anyway
        await db.session_requests.update_one(
            {"_id": ObjectId(request_id)},
            {"$set": {"status": "accepted"}}
        )
        # Return session
        session["id"] = str(session["_id"])
        session.pop("_id", None)
        if "privacy_type" not in session:
            session["privacy_type"] = "public" if not session.get("is_private", False) else "private"
        session.pop("is_private", None)
        session["members"] = [SessionMember(**m) for m in session.get("members", [])]
        return SessionResponse(**session)
    
    # Get requester info
    requester = await db.users.find_one({"_id": ObjectId(requester_id)})
    if not requester:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Requester not found"
        )
    
    # Add user to session members
    await db.sessions.update_one(
        {"_id": ObjectId(session_id)},
        {
            "$push": {
                "members": {
                    "user_id": requester_id,
                    "username": requester["username"],
                    "joined_at": datetime.utcnow()
                }
            },
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    
    # Update request status
    await db.session_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {"status": "accepted"}}
    )
    
    # Create notification for the requester
    notification = {
        "user_id": requester_id,
        "type": "request_accepted",
        "title": "Request Accepted",
        "message": f"Your request to join '{session['name']}' has been accepted!",
        "session_id": session_id,
        "is_read": False,
        "created_at": datetime.utcnow()
    }
    notification_result = await db.notifications.insert_one(notification)
    notification_id = str(notification_result.inserted_id)
    
    # Send real-time notification to the requester if they're connected
    requester_sids = [sid for sid, user_info in authenticated_users.items() if user_info["user_id"] == requester_id]
    for sid in requester_sids:
        await sio.emit('notification', {
            'notification_id': notification_id,
            'type': 'request_accepted',
            'title': 'Request Accepted',
            'message': f"Your request to join '{session['name']}' has been accepted!",
            'session_id': session_id
        }, room=sid)
    
    # Return updated session
    updated_session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    if "privacy_type" not in updated_session:
        updated_session["privacy_type"] = "public" if not updated_session.get("is_private", False) else "private"
    updated_session["id"] = str(updated_session["_id"])
    updated_session.pop("_id", None)
    updated_session.pop("is_private", None)
    updated_session["members"] = [SessionMember(**m) for m in updated_session.get("members", [])]
    
    return SessionResponse(**updated_session)

@app.post("/api/sessions/requests/{session_id}/{request_id}/decline")
async def decline_session_request(
    session_id: str,
    request_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Decline a session request (host only)"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Only host can decline
    if session["host_id"] != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the host can decline requests"
        )
    
    request = await db.session_requests.find_one({
        "_id": ObjectId(request_id),
        "session_id": session_id,
        "status": "pending"
    })
    
    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Request not found or already processed"
        )
    
    # Update request status
    await db.session_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {"status": "declined"}}
    )
    
    return {"message": "Request declined"}

# Notification endpoints
@app.get("/api/notifications", response_model=list[NotificationResponse])
async def get_notifications(
    current_user: dict = Depends(get_current_user)
):
    """Get all notifications for current user"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    notifications = await db.notifications.find({
        "user_id": current_user_id
    }).sort("created_at", -1).to_list(length=100)
    
    result = []
    for notif in notifications:
        notif["id"] = str(notif["_id"])
        notif.pop("_id", None)
        result.append(NotificationResponse(**notif))
    
    return result

@app.get("/api/notifications/unread", response_model=list[NotificationResponse])
async def get_unread_notifications(
    current_user: dict = Depends(get_current_user)
):
    """Get unread notifications for current user"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    notifications = await db.notifications.find({
        "user_id": current_user_id,
        "is_read": False
    }).sort("created_at", -1).to_list(length=100)
    
    result = []
    for notif in notifications:
        notif["id"] = str(notif["_id"])
        notif.pop("_id", None)
        result.append(NotificationResponse(**notif))
    
    return result

@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Mark a notification as read"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    notification = await db.notifications.find_one({
        "_id": ObjectId(notification_id),
        "user_id": current_user_id
    })
    
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found"
        )
    
    await db.notifications.update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"is_read": True}}
    )
    
    return {"message": "Notification marked as read"}

@app.post("/api/notifications/read-all")
async def mark_all_notifications_read(
    current_user: dict = Depends(get_current_user)
):
    """Mark all notifications as read for current user"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    await db.notifications.update_many(
        {"user_id": current_user_id, "is_read": False},
        {"$set": {"is_read": True}}
    )
    
    return {"message": "All notifications marked as read"}

@app.post("/api/sessions/{session_id}/leave", response_model=SessionResponse)
async def leave_session(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Leave a session"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Can't leave if you're the host
    if session["host_id"] == current_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Host cannot leave session. Delete the session instead."
        )
    
    # Remove user from members
    await db.sessions.update_one(
        {"_id": ObjectId(session_id)},
        {
            "$pull": {"members": {"user_id": current_user_id}},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    
    # Return updated session
    updated_session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    # Ensure privacy_type exists (for backward compatibility)
    if "privacy_type" not in updated_session:
        updated_session["privacy_type"] = "public" if not updated_session.get("is_private", False) else "private"
    updated_session["id"] = str(updated_session["_id"])
    updated_session.pop("_id", None)
    updated_session.pop("is_private", None)  # Remove is_private if it exists
    updated_session["members"] = [SessionMember(**m) for m in updated_session.get("members", [])]
    
    return SessionResponse(**updated_session)

@app.put("/api/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    session_data: SessionUpdate,
    current_user: dict = Depends(get_current_user)
):
    """Update a session (host only)"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Only host can update
    if session["host_id"] != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the host can update the session"
        )
    
    # Build update dict
    update_dict = {"updated_at": datetime.utcnow()}
    if session_data.name is not None:
        update_dict["name"] = session_data.name
    if session_data.description is not None:
        update_dict["description"] = session_data.description
    if session_data.track_id is not None:
        update_dict["track_id"] = session_data.track_id
    if session_data.track_name is not None:
        update_dict["track_name"] = session_data.track_name
    if session_data.track_artist is not None:
        update_dict["track_artist"] = session_data.track_artist
    if session_data.is_playing is not None:
        update_dict["is_playing"] = session_data.is_playing
    if session_data.position_ms is not None:
        update_dict["position_ms"] = session_data.position_ms
    
    await db.sessions.update_one(
        {"_id": ObjectId(session_id)},
        {"$set": update_dict}
    )
    
    # Return updated session
    updated_session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    # Ensure privacy_type exists (for backward compatibility)
    if "privacy_type" not in updated_session:
        updated_session["privacy_type"] = "public" if not updated_session.get("is_private", False) else "private"
    updated_session["id"] = str(updated_session["_id"])
    updated_session.pop("_id", None)
    updated_session.pop("is_private", None)  # Remove is_private if it exists
    updated_session["members"] = [SessionMember(**m) for m in updated_session.get("members", [])]
    
    return SessionResponse(**updated_session)

@app.post("/api/sessions/{session_id}/invite/{friend_id}", response_model=SessionInvitationResponse, status_code=status.HTTP_201_CREATED)
async def invite_friend_to_session(
    session_id: str,
    friend_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Invite a friend to a session (host only) - creates a pending invitation"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Only host can invite
    if session["host_id"] != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the host can invite friends to the session"
        )
    
    # Check if friend exists and is actually a friend
    friendship = await db.friends.find_one({
        "$or": [
            {"user_id": current_user_id, "friend_id": friend_id},
            {"user_id": friend_id, "friend_id": current_user_id}
        ]
    })
    
    if not friendship:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not your friend"
        )
    
    # Get friend user info
    friend = await db.users.find_one({"_id": ObjectId(friend_id)})
    if not friend:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Friend not found"
        )
    
    # Check if already a member
    is_member = any(m["user_id"] == friend_id for m in session.get("members", []))
    if is_member:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Friend is already a member of this session"
        )
    
    # Check if there's already a pending invitation
    existing_invitation = await db.session_invitations.find_one({
        "session_id": session_id,
        "invitee_id": friend_id,
        "status": "pending"
    })
    
    if existing_invitation:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invitation already sent"
        )
    
    # Create invitation
    invitation = {
        "session_id": session_id,
        "inviter_id": current_user_id,
        "invitee_id": friend_id,
        "status": "pending",
        "created_at": datetime.utcnow()
    }
    
    result = await db.session_invitations.insert_one(invitation)
    invitation["id"] = str(result.inserted_id)
    invitation.pop("_id", None)
    invitation["session_name"] = session["name"]
    invitation["inviter_username"] = current_user["username"]
    
    # Send real-time notification to the invitee if they're connected
    invitee_sids = [sid for sid, user_info in authenticated_users.items() if user_info["user_id"] == friend_id]
    for sid in invitee_sids:
        await sio.emit('session_invitation', {
            'invitation_id': invitation["id"],
            'session_id': session_id,
            'session_name': session["name"],
            'inviter_username': current_user["username"],
            'inviter_id': current_user_id
        }, room=sid)
    
    return SessionInvitationResponse(**invitation)

@app.post("/api/sessions/invitations/{invitation_id}/accept", response_model=SessionResponse)
async def accept_session_invitation(
    invitation_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Accept a session invitation"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    invitation = await db.session_invitations.find_one({
        "_id": ObjectId(invitation_id),
        "invitee_id": current_user_id,
        "status": "pending"
    })
    
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found or already processed"
        )
    
    session_id = invitation["session_id"]
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Check if already a member
    is_member = any(m["user_id"] == current_user_id for m in session.get("members", []))
    if is_member:
        # Update invitation status anyway
        await db.session_invitations.update_one(
            {"_id": ObjectId(invitation_id)},
            {"$set": {"status": "accepted"}}
        )
        # Return session
        session["id"] = str(session["_id"])
        session.pop("_id", None)
        if "privacy_type" not in session:
            session["privacy_type"] = "public" if not session.get("is_private", False) else "private"
        session.pop("is_private", None)
        session["members"] = [SessionMember(**m) for m in session.get("members", [])]
        return SessionResponse(**session)
    
    # Add user to session members
    await db.sessions.update_one(
        {"_id": ObjectId(session_id)},
        {
            "$push": {
                "members": {
                    "user_id": current_user_id,
                    "username": current_user["username"],
                    "joined_at": datetime.utcnow()
                }
            },
            "$set": {"updated_at": datetime.utcnow()}
        }
    )
    
    # Update invitation status
    await db.session_invitations.update_one(
        {"_id": ObjectId(invitation_id)},
        {"$set": {"status": "accepted"}}
    )
    
    # Return updated session
    updated_session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    if "privacy_type" not in updated_session:
        updated_session["privacy_type"] = "public" if not updated_session.get("is_private", False) else "private"
    updated_session["id"] = str(updated_session["_id"])
    updated_session.pop("_id", None)
    updated_session.pop("is_private", None)
    updated_session["members"] = [SessionMember(**m) for m in updated_session.get("members", [])]
    
    return SessionResponse(**updated_session)

@app.post("/api/sessions/invitations/{invitation_id}/reject")
async def reject_session_invitation(
    invitation_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Reject a session invitation"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    invitation = await db.session_invitations.find_one({
        "_id": ObjectId(invitation_id),
        "invitee_id": current_user_id,
        "status": "pending"
    })
    
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found or already processed"
        )
    
    # Update invitation status
    await db.session_invitations.update_one(
        {"_id": ObjectId(invitation_id)},
        {"$set": {"status": "rejected"}}
    )
    
    return {"message": "Invitation rejected"}

@app.delete("/api/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a session (host only)"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    session = await db.sessions.find_one({"_id": ObjectId(session_id)})
    
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Only host can delete
    if session["host_id"] != current_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the host can delete the session"
        )
    
    await db.sessions.delete_one({"_id": ObjectId(session_id)})
    
    return {"message": "Session deleted successfully"}

# Spotify OAuth endpoints
async def get_user_from_query_token(token: Optional[str] = Query(None)):
    """Dependency to get user from query token parameter"""
    # Only pass token_query if token is actually provided
    if token:
        return await get_current_user(token_query=token)
    else:
        # Fall back to cookie/auth header if no query token
        return await get_current_user()

@app.get("/spotify/connect")
async def spotify_connect(current_user: dict = Depends(get_user_from_query_token)):
    """Initiate Spotify OAuth flow"""
    if not settings.spotify_client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Spotify client ID not configured"
        )
    
    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)
    
    # Store state in user document temporarily
    db = get_database()
    current_user_id = str(current_user["_id"])
    await db.users.update_one(
        {"_id": ObjectId(current_user_id)},
        {"$set": {"spotify_oauth_state": state}}
    )
    
    # Spotify OAuth scopes
    scopes = [
        "user-read-private",
        "user-read-email",
        "user-read-playback-state",
        "user-modify-playback-state",
        "user-read-currently-playing",
        "streaming"
    ]
    
    # Build authorization URL
    auth_url = (
        "https://accounts.spotify.com/authorize?"
        f"client_id={settings.spotify_client_id}&"
        f"response_type=code&"
        f"redirect_uri={urllib.parse.quote(settings.spotify_redirect_uri)}&"
        f"scope={urllib.parse.quote(' '.join(scopes))}&"
        f"state={state}"
    )
    
    # Redirect to Spotify
    from fastapi.responses import RedirectResponse
    print(f"Redirecting to Spotify: {auth_url}")  # Debug log
    return RedirectResponse(url=auth_url, status_code=302)

@app.get("/spotify/callback")
async def spotify_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None
):
    """Handle Spotify OAuth callback"""
    if error:
        from fastapi.responses import RedirectResponse
        frontend_url = settings.frontend_url
        return RedirectResponse(url=f"{frontend_url}/profile?spotify_error={urllib.parse.quote(error)}")
    
    if not code or not state:
        from fastapi.responses import RedirectResponse
        frontend_url = settings.frontend_url
        return RedirectResponse(url=f"{frontend_url}/profile?spotify_error=missing_parameters")
    
    if not settings.spotify_client_id or not settings.spotify_client_secret:
        from fastapi.responses import RedirectResponse
        frontend_url = settings.frontend_url
        return RedirectResponse(url=f"{frontend_url}/profile?spotify_error=server_configuration")
    
    db = get_database()
    
    # Find user by state (state is stored in user document)
    user = await db.users.find_one({"spotify_oauth_state": state})
    if not user:
        from fastapi.responses import RedirectResponse
        frontend_url = settings.frontend_url
        return RedirectResponse(url=f"{frontend_url}/profile?spotify_error=invalid_state")
    
    current_user_id = str(user["_id"])
    
    # Exchange code for tokens
    token_url = "https://accounts.spotify.com/api/token"
    token_data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.spotify_redirect_uri,
    }
    
    # Base64 encode client_id:client_secret
    credentials = f"{settings.spotify_client_id}:{settings.spotify_client_secret}"
    encoded_credentials = base64.b64encode(credentials.encode()).decode()
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            token_url,
            data=token_data,
            headers={
                "Authorization": f"Basic {encoded_credentials}",
                "Content-Type": "application/x-www-form-urlencoded"
            }
        )
    
    if response.status_code != 200:
        from fastapi.responses import RedirectResponse
        frontend_url = settings.frontend_url
        return RedirectResponse(url=f"{frontend_url}/profile?spotify_error=token_exchange_failed")
    
    token_response = response.json()
    access_token = token_response.get("access_token")
    refresh_token = token_response.get("refresh_token")
    expires_in = token_response.get("expires_in", 3600)
    
    if not access_token:
        from fastapi.responses import RedirectResponse
        frontend_url = settings.frontend_url
        return RedirectResponse(url=f"{frontend_url}/profile?spotify_error=no_access_token")
    
    # Calculate expiration time
    expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
    
    # Store tokens in user document
    await db.users.update_one(
        {"_id": ObjectId(current_user_id)},
        {
            "$set": {
                "spotify_access_token": access_token,
                "spotify_refresh_token": refresh_token,
                "spotify_token_expires_at": expires_at,
                "spotify_connected_at": datetime.utcnow()
            },
            "$unset": {"spotify_oauth_state": ""}
        }
    )
    
    # Redirect back to frontend
    from fastapi.responses import RedirectResponse
    frontend_url = settings.frontend_url
    print(f"Spotify connection successful for user {current_user_id}")  # Debug log
    return RedirectResponse(url=f"{frontend_url}/profile?spotify_connected=true", status_code=302)

@app.get("/api/spotify/status")
async def get_spotify_status(current_user: dict = Depends(get_current_user)):
    """Check if user has Spotify connected"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    has_spotify = bool(user.get("spotify_access_token"))
    connected_at = user.get("spotify_connected_at")
    
    return {
        "connected": has_spotify,
        "connected_at": connected_at.isoformat() if connected_at else None
    }

@app.get("/api/spotify/token")
async def get_spotify_token(current_user: dict = Depends(get_current_user)):
    """Get user's Spotify access token"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    # Check if token is expired and refresh if needed
    expires_at = user.get("spotify_token_expires_at")
    if expires_at and expires_at < datetime.utcnow():
        # Token expired, refresh it
        refresh_token = user.get("spotify_refresh_token")
        if not refresh_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Spotify token expired and no refresh token available"
            )
        
        # Refresh the token
        token_url = "https://accounts.spotify.com/api/token"
        token_data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        
        credentials = f"{settings.spotify_client_id}:{settings.spotify_client_secret}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                token_url,
                data=token_data,
                headers={
                    "Authorization": f"Basic {encoded_credentials}",
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to refresh Spotify token"
            )
        
        token_response = response.json()
        access_token = token_response.get("access_token")
        expires_in = token_response.get("expires_in", 3600)
        expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
        
        # Update token in database
        await db.users.update_one(
            {"_id": ObjectId(current_user_id)},
            {
                "$set": {
                    "spotify_access_token": access_token,
                    "spotify_token_expires_at": expires_at
                }
            }
        )
    
    return {"access_token": access_token}

@app.get("/api/spotify/playlists")
async def get_spotify_playlists(current_user: dict = Depends(get_current_user)):
    """Get user's Spotify playlists"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    # Get playlists from Spotify API
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.spotify.com/v1/me/playlists",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"limit": 50}
        )
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch playlists: {response.text}"
        )
    
    return response.json()

@app.get("/api/spotify/playlists/{playlist_id}/tracks")
async def get_playlist_tracks(
    playlist_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Get tracks from a Spotify playlist"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"limit": 100}
        )
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch playlist tracks: {response.text}"
        )
    
    return response.json()

@app.get("/api/spotify/recommendations")
async def get_spotify_recommendations(
    seed_genres: Optional[str] = None,
    seed_artists: Optional[str] = None,
    seed_tracks: Optional[str] = None,
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Get Spotify recommendations"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    params = {"limit": limit}
    if seed_genres:
        params["seed_genres"] = seed_genres
    if seed_artists:
        params["seed_artists"] = seed_artists
    if seed_tracks:
        params["seed_tracks"] = seed_tracks
    
    # Validate that at least one seed parameter is provided
    if not seed_genres and not seed_artists and not seed_tracks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one seed parameter (seed_genres, seed_artists, or seed_tracks) is required"
        )
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.spotify.com/v1/recommendations",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params
        )
    
    if response.status_code != 200:
        error_text = response.text
        try:
            error_json = response.json()
            error_message = error_json.get("error", {}).get("message", error_text)
        except:
            error_message = error_text
        
        print(f"Spotify recommendations API error: {response.status_code} - {error_message}")
        print(f"Request params: {params}")
        
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch recommendations: {error_message}"
        )
    
    return response.json()

@app.get("/api/spotify/search")
async def search_spotify(
    q: str,
    type: str = "track",
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Search Spotify"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.spotify.com/v1/search",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"q": q, "type": type, "limit": limit}
        )
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to search: {response.text}"
        )
    
    return response.json()

@app.get("/api/spotify/popular")
async def get_popular_songs(
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get popular songs from Spotify's Global Top 50 playlist"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    async with httpx.AsyncClient() as client:
        # First, search for Global Top 50 playlist
        search_response = await client.get(
            "https://api.spotify.com/v1/search",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"q": "Global Top 50", "type": "playlist", "limit": 1}
        )
        
        if search_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to find popular playlist: {search_response.text}"
            )
        
        search_data = search_response.json()
        playlists = search_data.get("playlists", {}).get("items", [])
        
        if not playlists:
            # Fallback: Get featured playlists
            featured_response = await client.get(
                "https://api.spotify.com/v1/browse/featured-playlists",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"limit": 1}
            )
            
            if featured_response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to fetch featured playlists: {featured_response.text}"
                )
            
            featured_data = featured_response.json()
            playlists = featured_data.get("playlists", {}).get("items", [])
        
        if not playlists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No popular playlists found"
            )
        
        playlist_id = playlists[0]["id"]
        
        # Get tracks from the playlist
        tracks_response = await client.get(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"limit": limit, "fields": "items(track(id,name,artists,album,uri,duration_ms,popularity))"}
        )
        
        if tracks_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to fetch playlist tracks: {tracks_response.text}"
            )
        
        tracks_data = tracks_response.json()
        tracks = [item["track"] for item in tracks_data.get("items", []) if item.get("track")]
        
        return {"tracks": tracks}

@app.get("/api/spotify/latest")
async def get_latest_songs(
    limit: int = 50,
    country: str = "US",
    current_user: dict = Depends(get_current_user)
):
    """Get latest/new releases from Spotify"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    async with httpx.AsyncClient() as client:
        # Get new releases (albums)
        new_releases_response = await client.get(
            "https://api.spotify.com/v1/browse/new-releases",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"limit": 20, "country": country}
        )
        
        if new_releases_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to fetch new releases: {new_releases_response.text}"
            )
        
        new_releases_data = new_releases_response.json()
        albums = new_releases_data.get("albums", {}).get("items", [])
        
        # Get tracks from the latest albums
        all_tracks = []
        for album in albums[:10]:  # Limit to first 10 albums to avoid too many requests
            album_id = album["id"]
            album_tracks_response = await client.get(
                f"https://api.spotify.com/v1/albums/{album_id}/tracks",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"limit": 5}  # Get first 5 tracks from each album
            )
            
            if album_tracks_response.status_code == 200:
                album_tracks_data = album_tracks_response.json()
                tracks = album_tracks_data.get("items", [])
                
                # Enrich tracks with album info
                for track in tracks:
                    if track and track.get("id"):  # Ensure track is valid
                        # Ensure track has all required fields
                        enriched_track = {
                            "id": track.get("id"),
                            "name": track.get("name"),
                            "artists": track.get("artists", []),
                            "uri": track.get("uri"),
                            "duration_ms": track.get("duration_ms", 0),
                            "album": {
                                "id": album["id"],
                                "name": album["name"],
                                "images": album.get("images", []),
                                "release_date": album.get("release_date")
                            }
                        }
                        all_tracks.append(enriched_track)
                    
                    if len(all_tracks) >= limit:
                        break
            
            if len(all_tracks) >= limit:
                break
        
        return {"tracks": all_tracks[:limit]}

@app.get("/api/spotify/categories")
async def get_spotify_categories(
    country: str = "US",
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Get Spotify categories (genres/moods)"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.spotify.com/v1/browse/categories",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"country": country, "limit": limit}
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to fetch categories: {response.text}"
            )
        
        return response.json()

@app.get("/api/spotify/categories/{category_id}/playlists")
async def get_category_playlists(
    category_id: str,
    country: str = "US",
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Get playlists for a specific category"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.spotify.com/v1/browse/categories/{category_id}/playlists",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"country": country, "limit": limit}
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to fetch category playlists: {response.text}"
            )
        
        return response.json()

@app.get("/api/spotify/category-tracks")
async def get_category_tracks(
    category: str,
    limit: int = 20,
    current_user: dict = Depends(get_current_user)
):
    """Get tracks from a category by searching for playlists with that category name"""
    db = get_database()
    current_user_id = str(current_user["_id"])
    
    user = await db.users.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    access_token = user.get("spotify_access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Spotify not connected"
        )
    
    async with httpx.AsyncClient() as client:
        # Search for playlists with the category name
        search_response = await client.get(
            "https://api.spotify.com/v1/search",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"q": category, "type": "playlist", "limit": 5}
        )
        
        if search_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to search playlists: {search_response.text}"
            )
        
        search_data = search_response.json()
        playlists = search_data.get("playlists", {}).get("items", [])
        
        if not playlists:
            return {"tracks": []}
        
        # Get tracks from the first playlist
        playlist_id = playlists[0]["id"]
        tracks_response = await client.get(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"limit": limit, "fields": "items(track(id,name,artists,album,uri,duration_ms,popularity))"}
        )
        
        if tracks_response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to fetch playlist tracks: {tracks_response.text}"
            )
        
        tracks_data = tracks_response.json()
        tracks = [item["track"] for item in tracks_data.get("items", []) if item.get("track")]
        
        return {"tracks": tracks}

