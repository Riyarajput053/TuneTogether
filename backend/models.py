from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from bson import ObjectId

class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid objectid")
        return ObjectId(v)

    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update(type="string")

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None

# Friend models
class FriendRequestCreate(BaseModel):
    recipient_id: str

class FriendRequestResponse(BaseModel):
    id: str
    sender_id: str
    recipient_id: str
    status: str  # "pending", "accepted", "rejected"
    created_at: datetime
    
    class Config:
        from_attributes = True

class FriendResponse(BaseModel):
    id: str
    username: str
    email: str
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# Session models
class SessionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    platform: str  # "spotify", "youtube", etc.
    track_id: Optional[str] = None
    track_name: Optional[str] = None
    track_artist: Optional[str] = None
    is_private: bool = False

class SessionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    track_id: Optional[str] = None
    track_name: Optional[str] = None
    track_artist: Optional[str] = None
    is_playing: Optional[bool] = None
    position_ms: Optional[int] = None

class SessionMember(BaseModel):
    user_id: str
    username: str
    joined_at: datetime

class SessionResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    host_id: str
    host_username: str
    platform: str
    track_id: Optional[str] = None
    track_name: Optional[str] = None
    track_artist: Optional[str] = None
    is_playing: bool = False
    position_ms: int = 0
    is_private: bool = False
    members: list[SessionMember] = []
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

