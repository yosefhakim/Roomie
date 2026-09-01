class RoomieUser {
  const RoomieUser({
    required this.id,
    required this.username,
    required this.displayName,
    this.email,
    this.avatarUrl,
    this.isAdmin = false,
  });

  final String id;
  final String username;
  final String displayName;
  final String? email;
  final String? avatarUrl;
  final bool isAdmin;

  factory RoomieUser.fromJson(Map<String, dynamic> json) {
    return RoomieUser(
      id: json['id'] as String,
      username: json['username'] as String,
      displayName: json['displayName'] as String,
      email: json['email'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      isAdmin: json['isAdmin'] as bool? ?? false,
    );
  }
}
