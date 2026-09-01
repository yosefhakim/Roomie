/// Mirrors the JSON shape returned by backend/src/services/roomService.js's
/// getRoomState (as broadcast via the 'room:state' socket event), minus the
/// server-only `passwordHash` field which is stripped before it ever
/// reaches the client (see sanitizeRoom in roomHandlers.js).
class Room {
  const Room({
    required this.id,
    required this.name,
    required this.ownerId,
    required this.visibility,
    required this.maxMembers,
    required this.memberCount,
    required this.members,
    required this.status,
  });

  final String id;
  final String name;
  final String ownerId;
  final String visibility; // 'public' | 'private' | 'password'
  final int maxMembers;
  final int memberCount;
  final List<RoomMember> members;
  final String status; // 'lobby' | future in-game statuses

  factory Room.fromJson(Map<String, dynamic> json) {
    return Room(
      id: json['id'] as String,
      name: json['name'] as String,
      ownerId: json['ownerId'] as String,
      visibility: json['visibility'] as String,
      maxMembers: json['maxMembers'] as int,
      memberCount: json['memberCount'] as int,
      status: json['status'] as String? ?? 'lobby',
      members: (json['members'] as List<dynamic>? ?? [])
          .map((m) => RoomMember.fromJson(m as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// Mirrors the member object shape stored in Redis by roomService.js
/// (`{ userId, displayName, role, joinedAt, connected, muted, handRaised }`).
class RoomMember {
  const RoomMember({
    required this.userId,
    required this.displayName,
    required this.role,
    required this.connected,
    required this.muted,
    required this.handRaised,
  });

  final String userId;
  final String displayName;
  final String role; // 'owner' | 'admin' | 'speaker' | 'listener'
  final bool connected;
  final bool muted;
  final bool handRaised;

  bool get canPublishVoice => role == 'owner' || role == 'admin' || role == 'speaker';

  factory RoomMember.fromJson(Map<String, dynamic> json) {
    return RoomMember(
      userId: json['userId'] as String,
      displayName: json['displayName'] as String,
      role: json['role'] as String,
      connected: json['connected'] as bool? ?? true,
      muted: json['muted'] as bool? ?? true,
      handRaised: json['handRaised'] as bool? ?? false,
    );
  }
}
