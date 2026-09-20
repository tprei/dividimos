UPDATE guest_credentials.assignment_room_access
SET broadcast_topic = 'assignment:' || room_id::text || ':' ||
  substring(broadcast_topic FROM '^assignment-room:([A-Za-z0-9_-]{43})$')
WHERE broadcast_topic ~ '^assignment-room:[A-Za-z0-9_-]{43}$';
