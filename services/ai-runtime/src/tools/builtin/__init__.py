from .calendar_booking import book_calendar
from .crm_lookup import lookup_crm
from .transfer_call import transfer_call
from .send_sms import send_sms
from ..registry import registry

# Register all built-in tools
registry.register(
    name="calendar_booking",
    description="Book a calendar appointment for the caller",
    parameters_schema={
        "type": "object",
        "properties": {
            "date": {"type": "string", "description": "Appointment date (ISO 8601)"},
            "time": {"type": "string", "description": "Appointment time (HH:MM)"},
            "duration_minutes": {"type": "integer", "description": "Duration in minutes"},
            "attendee_name": {"type": "string"},
            "attendee_email": {"type": "string"},
            "notes": {"type": "string"},
        },
        "required": ["date", "time", "attendee_name"],
    },
    fn=book_calendar,
)

registry.register(
    name="crm_lookup",
    description="Look up a contact or lead in the CRM system",
    parameters_schema={
        "type": "object",
        "properties": {
            "phone": {"type": "string"},
            "email": {"type": "string"},
            "name": {"type": "string"},
        },
    },
    fn=lookup_crm,
)

registry.register(
    name="transfer_call",
    description="Transfer the current call to another agent or department",
    parameters_schema={
        "type": "object",
        "properties": {
            "target": {"type": "string", "description": "Target agent ID or department name"},
            "reason": {"type": "string"},
        },
        "required": ["target"],
    },
    fn=transfer_call,
)

registry.register(
    name="send_sms",
    description="Send an SMS message to the caller",
    parameters_schema={
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "Phone number"},
            "body": {"type": "string", "description": "Message body"},
        },
        "required": ["to", "body"],
    },
    fn=send_sms,
)
