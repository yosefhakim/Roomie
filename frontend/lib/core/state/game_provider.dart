import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/game_state.dart';
import '../network/socket_manager.dart';
import 'core_providers.dart';

class GameController extends StateNotifier<GameStateEnvelope?> {
  GameController(this._ref) : super(null) {
    _subscription = _ref.read(socketManagerProvider).gameEvents.listen(_handleEvent);
  }

  final Ref _ref;
  late final StreamSubscription<SocketEvent> _subscription;

  final _correctGuessController = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get correctGuessEvents => _correctGuessController.stream;

  final _strokeController = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get incomingStrokes => _strokeController.stream;

  final _clearController = StreamController<void>.broadcast();
  Stream<void> get clearEvents => _clearController.stream;

  void _handleEvent(SocketEvent event) {
    switch (event.name) {
      case 'game:state':
        state = GameStateEnvelope.fromJson(Map<String, dynamic>.from(event.data as Map));
        break;
      case 'game:drawguess:correctGuess':
        _correctGuessController.add(Map<String, dynamic>.from(event.data as Map));
        break;
      case 'game:draw:stroke':
        _strokeController.add(Map<String, dynamic>.from(event.data as Map));
        break;
      case 'game:draw:clear':
        _clearController.add(null);
        break;
    }
  }

  /// [gameType] is one of 'spy' | 'mafia' | 'draw_guess'. Only the room
  /// owner may call this successfully - enforced server-side in
  /// gameHandlers.js's game:start handler.
  Future<Map<String, dynamic>> startGame(String roomId, String gameType) {
    return _ref.read(socketManagerProvider).emitWithAck('game:start', {'roomId': roomId, 'gameType': gameType});
  }

  // --- Who's the Spy ---
  Future<Map<String, dynamic>> spyDescribe(String roomId) {
    return _ref.read(socketManagerProvider).emitWithAck('game:spy:describe', {'roomId': roomId});
  }

  Future<Map<String, dynamic>> spyVote(String roomId, String targetId) {
    return _ref.read(socketManagerProvider).emitWithAck('game:spy:vote', {'roomId': roomId, 'targetId': targetId});
  }

  // --- Mafia ---
  Future<Map<String, dynamic>> mafiaNightAction(String roomId, String actionType, String targetId) {
    return _ref.read(socketManagerProvider).emitWithAck('game:mafia:nightAction', {
      'roomId': roomId,
      'actionType': actionType, // 'mafia_vote' | 'detective_check' | 'doctor_protect'
      'targetId': targetId,
    });
  }

  Future<Map<String, dynamic>> mafiaDayVote(String roomId, String targetId) {
    return _ref.read(socketManagerProvider).emitWithAck('game:mafia:dayVote', {'roomId': roomId, 'targetId': targetId});
  }

  // --- Draw & Guess ---
  Future<Map<String, dynamic>> drawGuessSelectWord(String roomId, String word) {
    return _ref.read(socketManagerProvider).emitWithAck('game:drawguess:selectWord', {'roomId': roomId, 'word': word});
  }

  Future<Map<String, dynamic>> drawGuessSubmitGuess(String roomId, String guess) {
    return _ref.read(socketManagerProvider).emitWithAck('game:drawguess:guess', {'roomId': roomId, 'guess': guess});
  }

  /// [stroke] is an opaque map (points, color, width) - the server relays
  /// it verbatim (see gameHandlers.js's game:draw:stroke handler), so its
  /// exact shape is a pure client-side rendering concern, defined by
  /// whatever the drawing widget (widgets/drawing_canvas.dart) produces.
  void sendStroke(String roomId, Map<String, dynamic> stroke) {
    _ref.read(socketManagerProvider).emit('game:draw:stroke', {'roomId': roomId, 'stroke': stroke});
  }

  void sendClear(String roomId) {
    _ref.read(socketManagerProvider).emit('game:draw:clear', {'roomId': roomId});
  }

  @override
  void dispose() {
    _subscription.cancel();
    _correctGuessController.close();
    _strokeController.close();
    _clearController.close();
    super.dispose();
  }
}

final gameControllerProvider = StateNotifierProvider<GameController, GameStateEnvelope?>((ref) => GameController(ref));
