#!/usr/bin/env python3
"""Print current timestamp. Used by AI agents for message timestamps."""
from datetime import datetime
print(datetime.now().strftime("%Y-%m-%d %H:%M %A"))
