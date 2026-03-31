from typing import List, Optional
from pydantic import BaseModel


class BlackbuckVehicle(BaseModel):
    registration_number: str
    status: str = "unknown"
    ignition: Optional[str] = "OFF"
    latitude: Optional[float] = 0.0
    longitude: Optional[float] = 0.0
    speed: Optional[float] = 0.0
    odometer: Optional[float] = None
    battery: Optional[float] = None
    address: Optional[str] = None
    last_updated: Optional[str] = ""


class BlackbuckData(BaseModel):
    vehicles: List[BlackbuckVehicle] = []
    error: Optional[str] = None
