/// Mirrors the envelope every `game:state` socket event arrives in (see
/// backend/src/games/gameHandlers.js's broadcastGameState): a common
/// wrapper around a game-specific, PER-PLAYER-REDACTED `state` blob. The
/// redaction happens entirely server-side (spyEngine.js /
/// mafiaEngine.js / drawGuessEngine.js's redactStateForPlayer functions) -
/// this client model never needs to hide anything itself, because the
/// server never sent the hidden fields in the first place.
class GameStateEnvelope {
  const GameStateEnvelope({
    required this.roomId,
    required this.gameType,
    required this.phase,
    required this.phaseEndsAt,
    required this.rawState,
  });

  final String roomId;
  final String gameType; // 'spy' | 'mafia' | 'draw_guess'
  final String phase;
  final DateTime? phaseEndsAt;
  final Map<String, dynamic> rawState;

  factory GameStateEnvelope.fromJson(Map<String, dynamic> json) {
    return GameStateEnvelope(
      roomId: json['roomId'] as String,
      gameType: json['gameType'] as String,
      phase: json['phase'] as String,
      phaseEndsAt: json['phaseEndsAt'] != null
          ? DateTime.fromMillisecondsSinceEpoch(json['phaseEndsAt'] as int)
          : null,
      rawState: Map<String, dynamic>.from(json['state'] as Map),
    );
  }

  /// Countdown duration for rendering a local timer UI. The countdown
  /// itself is purely a display convenience - actual phase transitions are
  /// server-authoritative (see gameTimer.js on the backend); this client
  /// never decides a phase has ended on its own.
  Duration? get timeRemaining {
    if (phaseEndsAt == null) return null;
    final remaining = phaseEndsAt!.difference(DateTime.now());
    return remaining.isNegative ? Duration.zero : remaining;
  }

  SpyGameState asSpyState() => SpyGameState.fromJson(rawState);
  MafiaGameState asMafiaState() => MafiaGameState.fromJson(rawState);
  DrawGuessGameState asDrawGuessState() => DrawGuessGameState.fromJson(rawState);
}

/// Matches spyEngine.js's redactStateForPlayer output shape exactly.
class SpyGameState {
  const SpyGameState({
    required this.round,
    required this.players,
    required this.currentTurnPlayerId,
    required this.voteCount,
    required this.myVote,
    required this.eliminationHistory,
    required this.winner,
  });

  final int round;
  final Map<String, SpyPlayerView> players;
  final String? currentTurnPlayerId;
  final int voteCount;
  final String? myVote;
  final List<dynamic> eliminationHistory;
  final String? winner; // 'civilians' | 'spies' | null

  factory SpyGameState.fromJson(Map<String, dynamic> json) {
    final playersJson = Map<String, dynamic>.from(json['players'] as Map);
    return SpyGameState(
      round: json['round'] as int,
      players: playersJson.map((k, v) => MapEntry(k, SpyPlayerView.fromJson(Map<String, dynamic>.from(v as Map)))),
      currentTurnPlayerId: json['currentTurnPlayerId'] as String?,
      voteCount: json['voteCount'] as int? ?? 0,
      myVote: json['myVote'] as String?,
      eliminationHistory: json['eliminationHistory'] as List<dynamic>? ?? [],
      winner: json['winner'] as String?,
    );
  }
}

class SpyPlayerView {
  const SpyPlayerView({required this.id, required this.alive, required this.hasDescribed, this.role, this.word});
  final String id;
  final bool alive;
  final bool hasDescribed;
  // Null for every player except: yourself (always), or everyone once the
  // game has ended - exactly matching what the server chose to send, per
  // spyEngine.js's redactStateForPlayer.
  final String? role;
  final String? word;

  factory SpyPlayerView.fromJson(Map<String, dynamic> json) => SpyPlayerView(
        id: json['id'] as String,
        alive: json['alive'] as bool,
        hasDescribed: json['hasDescribed'] as bool,
        role: json['role'] as String?,
        word: json['word'] as String?,
      );
}

/// Matches mafiaEngine.js's redactStateForPlayer output shape exactly.
class MafiaGameState {
  const MafiaGameState({
    required this.round,
    required this.players,
    required this.myRole,
    required this.lastNightResult,
    required this.dayVoteCount,
    required this.myDayVote,
    required this.eliminationHistory,
    required this.winner,
  });

  final int round;
  final Map<String, MafiaPlayerView> players;
  final String? myRole;
  final Map<String, dynamic>? lastNightResult;
  final int dayVoteCount;
  final String? myDayVote;
  final List<dynamic> eliminationHistory;
  final String? winner; // 'mafia' | 'villagers' | null

  factory MafiaGameState.fromJson(Map<String, dynamic> json) {
    final playersJson = Map<String, dynamic>.from(json['players'] as Map);
    return MafiaGameState(
      round: json['round'] as int,
      players: playersJson.map((k, v) => MapEntry(k, MafiaPlayerView.fromJson(Map<String, dynamic>.from(v as Map)))),
      myRole: json['myRole'] as String?,
      lastNightResult: json['lastNightResult'] != null ? Map<String, dynamic>.from(json['lastNightResult'] as Map) : null,
      dayVoteCount: json['dayVoteCount'] as int? ?? 0,
      myDayVote: json['myDayVote'] as String?,
      eliminationHistory: json['eliminationHistory'] as List<dynamic>? ?? [],
      winner: json['winner'] as String?,
    );
  }
}

class MafiaPlayerView {
  const MafiaPlayerView({required this.id, required this.alive, this.role});
  final String id;
  final bool alive;
  final String? role; // visible per redaction rules in mafiaEngine.js

  factory MafiaPlayerView.fromJson(Map<String, dynamic> json) =>
      MafiaPlayerView(id: json['id'] as String, alive: json['alive'] as bool, role: json['role'] as String?);
}

/// Matches drawGuessEngine.js's redactStateForPlayer output shape exactly.
class DrawGuessGameState {
  const DrawGuessGameState({
    required this.round,
    required this.totalRounds,
    required this.drawerId,
    required this.isDrawer,
    required this.wordOptions,
    required this.currentWord,
    required this.wordLength,
    required this.players,
    required this.hasGuessedCorrectly,
    required this.winner,
  });

  final int round;
  final int totalRounds;
  final String drawerId;
  final bool isDrawer;
  final List<String>? wordOptions; // only present for the drawer during word_selection
  final String? currentWord; // only present for the drawer during drawing, or everyone at round_end/ended
  final int? wordLength; // blanks hint for non-drawers, e.g. render "_ _ _ _ _"
  final Map<String, dynamic> players; // { id, score, roundsDrawn }
  final bool hasGuessedCorrectly;
  final String? winner;

  factory DrawGuessGameState.fromJson(Map<String, dynamic> json) {
    return DrawGuessGameState(
      round: json['round'] as int,
      totalRounds: json['totalRounds'] as int,
      drawerId: json['drawerId'] as String,
      isDrawer: json['isDrawer'] as bool,
      wordOptions: (json['wordOptions'] as List<dynamic>?)?.map((e) => e as String).toList(),
      currentWord: json['currentWord'] as String?,
      wordLength: json['wordLength'] as int?,
      players: Map<String, dynamic>.from(json['players'] as Map),
      hasGuessedCorrectly: json['hasGuessedCorrectly'] as bool? ?? false,
      winner: json['winner'] as String?,
    );
  }
}
