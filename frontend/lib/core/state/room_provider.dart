import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/room.dart';
import '../network/socket_manager.dart';
import 'core_providers.dart';

class RoomController extends StateNotifier<Room?> {
  RoomController(this._ref) : super(null) {
    _subscription = _ref.read(socketManagerProvider).roomEvents.listen(_handleEvent);
  }

  final Ref _ref;
  late final StreamSubscription<SocketEvent> _subscription;

  void _handleEvent(SocketEvent event) {
    switch (event.name) {
      case 'room:state':
        state = Room.fromJson(Map<String, dynamic>.from(event.data as Map));
        break;
      case 'room:memberJoined':
      case 'room:memberLeft':
      case 'room:memberUpdated':
        // These are supplementary notifications (e.g. for toast messages /
        // system chat lines); the authoritative member list always comes
        // from the room:state broadcast the server sends immediately after
        // each of these (see roomHandlers.js - every mutating handler emits
        // room:state right after its more specific event). We don't
        // reconstruct state from these partial events to avoid two sources
        // of truth drifting.
        break;
      case 'room:kicked':
        state = null;
        break;
      case 'room:forceClosed':
        state = null;
        break;
    }
  }

  Future<Map<String, dynamic>> createRoom({
    required String name,
    String visibility = 'public',
    String? password,
    int? maxMembers,
  }) {
    return _ref.read(socketManagerProvider).emitWithAck('room:create', {
      'name': name,
      'visibility': visibility,
      if (password != null) 'password': password,
      if (maxMembers != null) 'maxMembers': maxMembers,
    });
  }

  Future<Map<String, dynamic>> joinRoom(String roomId, {String? password}) {
    return _ref.read(socketManagerProvider).emitWithAck('room:join', {
      'roomId': roomId,
      if (password != null) 'password': password,
    });
  }

  Future<Map<String, dynamic>> leaveRoom(String roomId) {
    final result = _ref.read(socketManagerProvider).emitWithAck('room:leave', {'roomId': roomId});
    state = null;
    return result;
  }

  Future<Map<String, dynamic>> setRole(String roomId, String targetUserId, String newRole) {
    return _ref.read(socketManagerProvider).emitWithAck('room:setRole', {
      'roomId': roomId,
      'targetUserId': targetUserId,
      'newRole': newRole,
    });
  }

  Future<Map<String, dynamic>> setMute(String roomId, String targetUserId, bool muted) {
    return _ref.read(socketManagerProvider).emitWithAck('room:setMute', {
      'roomId': roomId,
      'targetUserId': targetUserId,
      'muted': muted,
    });
  }

  Future<Map<String, dynamic>> raiseHand(String roomId, bool raised) {
    return _ref.read(socketManagerProvider).emitWithAck('room:raiseHand', {'roomId': roomId, 'raised': raised});
  }

  Future<Map<String, dynamic>> kick(String roomId, String targetUserId) {
    return _ref.read(socketManagerProvider).emitWithAck('room:kick', {'roomId': roomId, 'targetUserId': targetUserId});
  }

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}

final roomControllerProvider = StateNotifierProvider<RoomController, Room?>((ref) => RoomController(ref));
