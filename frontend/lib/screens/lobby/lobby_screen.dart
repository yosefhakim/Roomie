import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/state/core_providers.dart';
import '../../core/state/room_provider.dart';
import '../../core/theme/roomie_theme.dart';
import '../../models/room.dart';
import '../../widgets/create_room_sheet.dart';

class LobbyScreen extends ConsumerStatefulWidget {
  const LobbyScreen({super.key});

  @override
  ConsumerState<LobbyScreen> createState() => _LobbyScreenState();
}

class _LobbyScreenState extends ConsumerState<LobbyScreen> {
  List<Room> _rooms = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _fetchRooms();
  }

  Future<void> _fetchRooms() async {
    setState(() => _loading = true);
    try {
      // GET /api/rooms - see backend/src/routes/rooms.js. Public REST
      // listing, separate from the live socket-pushed room:state a client
      // gets once actually inside a room.
      final response = await ref.read(apiClientProvider).dio.get('/api/rooms');
      final roomsJson = (response.data['rooms'] as List<dynamic>).cast<Map<String, dynamic>>();
      setState(() => _rooms = roomsJson.map(Room.fromJson).toList());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _joinRoom(Room room) async {
    try {
      await ref.read(roomControllerProvider.notifier).joinRoom(room.id);
      if (mounted) context.go('/room/${room.id}');
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not join: $err')));
      }
    }
  }

  Future<void> _showCreateRoomSheet() async {
    final createdRoomId = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: RoomieColors.surfaceRaised,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => const CreateRoomSheet(),
    );
    if (createdRoomId != null && mounted) {
      context.go('/room/$createdRoomId');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Roomie'),
        actions: [
          IconButton(icon: const Icon(Icons.person_outline), onPressed: () => context.push('/profile')),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showCreateRoomSheet,
        icon: const Icon(Icons.add),
        label: const Text('Create Room'),
      ),
      body: RefreshIndicator(
        onRefresh: _fetchRooms,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _rooms.isEmpty
                ? ListView(
                    children: const [
                      SizedBox(height: 120),
                      Center(
                        child: Text('No active rooms right now', style: TextStyle(color: RoomieColors.textSecondary)),
                      ),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _rooms.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final room = _rooms[index];
                      return Card(
                        child: ListTile(
                          contentPadding: const EdgeInsets.all(16),
                          title: Text(room.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Row(
                              children: [
                                Icon(_visibilityIcon(room.visibility), size: 14, color: RoomieColors.textSecondary),
                                const SizedBox(width: 4),
                                Text(
                                  '${room.memberCount}/${room.maxMembers} members',
                                  style: const TextStyle(color: RoomieColors.textSecondary, fontSize: 13),
                                ),
                              ],
                            ),
                          ),
                          trailing: ElevatedButton(onPressed: () => _joinRoom(room), child: const Text('Join')),
                        ),
                      );
                    },
                  ),
      ),
    );
  }

  IconData _visibilityIcon(String visibility) {
    switch (visibility) {
      case 'private':
        return Icons.lock_outline;
      case 'password':
        return Icons.key_outlined;
      default:
        return Icons.public;
    }
  }
}
