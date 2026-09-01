import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'token_storage.dart';

/// Wraps the Socket.IO connection lifecycle and exposes a typed stream per
/// event family, so screens/providers subscribe to `roomEvents`,
/// `gameEvents`, `voiceEvents` rather than calling `socket.on(...)`
/// scattered across the widget tree.
///
/// Auth contract matches backend/src/middleware/socketAuth.js exactly:
/// connects with `auth: { accessToken }`. On an auth-related connect
/// error, this class does NOT attempt to refresh-and-reconnect itself
/// (unlike the REST ApiClient) - that responsibility lives in the
/// connection-owning provider (core/state/socket_provider.dart), which can
/// coordinate with ApiClient's refresh flow and avoid the two clients
/// racing to refresh independently.
class SocketManager {
  SocketManager({required this.baseUrl, required TokenStorage tokenStorage}) : _tokenStorage = tokenStorage;

  final String baseUrl;
  final TokenStorage _tokenStorage;
  io.Socket? _socket;

  final _connectionStateController = StreamController<SocketConnectionState>.broadcast();
  final _roomEventsController = StreamController<SocketEvent>.broadcast();
  final _gameEventsController = StreamController<SocketEvent>.broadcast();
  final _voiceEventsController = StreamController<SocketEvent>.broadcast();

  Stream<SocketConnectionState> get connectionState => _connectionStateController.stream;
  Stream<SocketEvent> get roomEvents => _roomEventsController.stream;
  Stream<SocketEvent> get gameEvents => _gameEventsController.stream;
  Stream<SocketEvent> get voiceEvents => _voiceEventsController.stream;

  bool get isConnected => _socket?.connected ?? false;

  Future<void> connect() async {
    final accessToken = await _tokenStorage.getAccessToken();
    if (accessToken == null) {
      _connectionStateController.add(SocketConnectionState.unauthenticated);
      return;
    }

    _socket?.dispose();
    _socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .setAuth({'accessToken': accessToken})
          .build(),
    );

    _bindLifecycleEvents();
    _bindRoomEvents();
    _bindGameEvents();
    _bindVoiceEvents();

    _socket!.connect();
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }

  void _bindLifecycleEvents() {
    _socket!.onConnect((_) => _connectionStateController.add(SocketConnectionState.connected));
    _socket!.onDisconnect((_) => _connectionStateController.add(SocketConnectionState.disconnected));
    _socket!.onConnectError((err) {
      // Matches the error strings the server sends via next(new Error(...))
      // in socketAuth.js: 'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'INVALID_TOKEN',
      // 'USER_NOT_FOUND', 'ACCOUNT_BANNED'.
      final message = err.toString();
      if (message.contains('TOKEN_EXPIRED') || message.contains('UNAUTHENTICATED') || message.contains('INVALID_TOKEN')) {
        _connectionStateController.add(SocketConnectionState.tokenExpired);
      } else if (message.contains('ACCOUNT_BANNED')) {
        _connectionStateController.add(SocketConnectionState.banned);
      } else {
        _connectionStateController.add(SocketConnectionState.error);
      }
    });
  }

  // Room events - mirrors backend/src/sockets/roomHandlers.js broadcasts.
  void _bindRoomEvents() {
    for (final event in [
      'room:state',
      'room:memberJoined',
      'room:memberLeft',
      'room:memberUpdated',
      'room:kicked',
      'room:forceClosed',
    ]) {
      _socket!.on(event, (data) => _roomEventsController.add(SocketEvent(event, data)));
    }
  }

  // Game events - mirrors backend/src/games/gameHandlers.js broadcasts.
  void _bindGameEvents() {
    for (final event in [
      'game:state',
      'game:drawguess:correctGuess',
      'game:draw:stroke',
      'game:draw:clear',
      'gift:received', // economy event, but arrives during gameplay - see room_screen.dart
    ]) {
      _socket!.on(event, (data) => _gameEventsController.add(SocketEvent(event, data)));
    }
  }

  // Voice events - mirrors backend/src/sockets/voiceHandlers.js and the
  // voice:roleChanged emission in roomHandlers.js's room:setRole handler.
  void _bindVoiceEvents() {
    for (final event in ['voice:activity', 'voice:roleChanged']) {
      _socket!.on(event, (data) => _voiceEventsController.add(SocketEvent(event, data)));
    }
  }

  /// Emits an event with an acknowledgement callback, wrapped as a Future -
  /// matches every ack-style handler on the backend (room:create,
  /// room:join, game:start, etc., all call `ack({ ok, ... })`).
  Future<Map<String, dynamic>> emitWithAck(String event, Map<String, dynamic> payload) {
    final completer = Completer<Map<String, dynamic>>();
    _socket!.emitWithAck(event, payload, ack: (response) {
      if (response is Map) {
        completer.complete(Map<String, dynamic>.from(response));
      } else {
        completer.completeError(Exception('Malformed ack response for $event'));
      }
    });
    return completer.future;
  }

  /// Fire-and-forget emit for high-frequency, non-critical events
  /// (voice:activity, game:draw:stroke) where waiting for an ack would add
  /// needless latency to a per-frame signal.
  void emit(String event, Map<String, dynamic> payload) {
    _socket?.emit(event, payload);
  }

  void dispose() {
    disconnect();
    _connectionStateController.close();
    _roomEventsController.close();
    _gameEventsController.close();
    _voiceEventsController.close();
  }
}

enum SocketConnectionState { connected, disconnected, unauthenticated, tokenExpired, banned, error }

class SocketEvent {
  SocketEvent(this.name, this.data);
  final String name;
  final dynamic data;
}
