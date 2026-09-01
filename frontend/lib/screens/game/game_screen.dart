import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/state/game_provider.dart';
import '../../core/theme/roomie_theme.dart';
import '../../widgets/spy_game_view.dart';
import '../../widgets/mafia_game_view.dart';
import '../../widgets/draw_guess_game_view.dart';

class GameScreen extends ConsumerWidget {
  const GameScreen({super.key, required this.roomId});
  final String roomId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final envelope = ref.watch(gameControllerProvider);

    if (envelope == null) {
      return Scaffold(
        appBar: AppBar(leading: BackButton(onPressed: () => context.pop())),
        body: const Center(
          child: Text('Waiting for game to start...', style: TextStyle(color: RoomieColors.textSecondary)),
        ),
      );
    }

    // Every phase transition in every game is server-authoritative (see
    // backend/src/games/gameTimer.js) - this countdown is purely a display
    // convenience computed from the server-provided phaseEndsAt timestamp,
    // never a client-side decision that a phase has ended.
    return Scaffold(
      appBar: AppBar(
        leading: BackButton(onPressed: () => context.pop()),
        title: Text(_titleFor(envelope.gameType)),
        actions: [
          if (envelope.phaseEndsAt != null) _PhaseCountdown(phaseEndsAt: envelope.phaseEndsAt!),
          const SizedBox(width: 12),
        ],
      ),
      body: switch (envelope.gameType) {
        'spy' => SpyGameView(roomId: roomId, envelope: envelope),
        'mafia' => MafiaGameView(roomId: roomId, envelope: envelope),
        'draw_guess' => DrawGuessGameView(roomId: roomId, envelope: envelope),
        _ => Center(child: Text('Unknown game type: ${envelope.gameType}')),
      },
    );
  }

  String _titleFor(String gameType) => switch (gameType) {
        'spy' => "Who's the Spy",
        'mafia' => 'Mafia',
        'draw_guess' => 'Draw & Guess',
        _ => 'Game',
      };
}

class _PhaseCountdown extends StatefulWidget {
  const _PhaseCountdown({required this.phaseEndsAt});
  final DateTime phaseEndsAt;

  @override
  State<_PhaseCountdown> createState() => _PhaseCountdownState();
}

class _PhaseCountdownState extends State<_PhaseCountdown> {
  @override
  Widget build(BuildContext context) {
    return StreamBuilder<int>(
      stream: Stream.periodic(const Duration(seconds: 1), (i) => i),
      builder: (context, snapshot) {
        final remaining = widget.phaseEndsAt.difference(DateTime.now());
        final seconds = remaining.isNegative ? 0 : remaining.inSeconds;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: seconds <= 5 ? RoomieColors.danger.withOpacity(0.15) : RoomieColors.surfaceOverlay,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            '${seconds}s',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: seconds <= 5 ? RoomieColors.danger : RoomieColors.textPrimary,
            ),
          ),
        );
      },
    );
  }
}
