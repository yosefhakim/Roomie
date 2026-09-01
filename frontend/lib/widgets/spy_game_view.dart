import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/state/auth_provider.dart';
import '../core/state/game_provider.dart';
import '../core/theme/roomie_theme.dart';
import '../models/game_state.dart';

class SpyGameView extends ConsumerWidget {
  const SpyGameView({super.key, required this.roomId, required this.envelope});
  final String roomId;
  final GameStateEnvelope envelope;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = envelope.asSpyState();
    final authState = ref.watch(authProvider);
    final myUserId = authState is AuthAuthenticated ? authState.user.id : null;
    final myPlayer = myUserId != null ? state.players[myUserId] : null;

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (state.winner != null)
            _WinnerBanner(winner: state.winner!)
          else if (myPlayer?.word != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    const Text('Your word', style: TextStyle(color: RoomieColors.textSecondary, fontSize: 13)),
                    const SizedBox(height: 8),
                    Text(myPlayer!.word!, style: Theme.of(context).textTheme.headlineSmall),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 20),
          Text('Round ${state.round}', style: const TextStyle(color: RoomieColors.textSecondary)),
          const SizedBox(height: 12),
          Expanded(
            child: ListView(
              children: state.players.values.map((p) {
                final isCurrentTurn = p.id == state.currentTurnPlayerId;
                return Card(
                  color: isCurrentTurn ? RoomieColors.accentMuted : RoomieColors.surfaceRaised,
                  child: ListTile(
                    enabled: p.alive,
                    title: Text(p.id == myUserId ? '${p.id} (You)' : p.id),
                    subtitle: !p.alive && p.role != null ? Text('Eliminated - was ${p.role}') : null,
                    trailing: envelope.phase == 'voting' && p.alive && p.id != myUserId
                        ? OutlinedButton(
                            onPressed: state.myVote != null
                                ? null
                                : () => ref.read(gameControllerProvider.notifier).spyVote(roomId, p.id),
                            child: Text(state.myVote == p.id ? 'Voted' : 'Vote'),
                          )
                        : (isCurrentTurn && p.id == myUserId && envelope.phase == 'describing')
                            ? ElevatedButton(
                                onPressed: () => ref.read(gameControllerProvider.notifier).spyDescribe(roomId),
                                child: const Text("I've described"),
                              )
                            : null,
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _WinnerBanner extends StatelessWidget {
  const _WinnerBanner({required this.winner});
  final String winner;

  @override
  Widget build(BuildContext context) {
    final civiliansWon = winner == 'civilians';
    return Card(
      color: civiliansWon ? RoomieColors.success.withOpacity(0.12) : RoomieColors.danger.withOpacity(0.12),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Icon(civiliansWon ? Icons.shield_outlined : Icons.visibility_off, size: 32),
            const SizedBox(height: 8),
            Text(
              civiliansWon ? 'Civilians win!' : 'The spy wins!',
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ],
        ),
      ),
    );
  }
}
