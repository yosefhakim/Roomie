import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/state/auth_provider.dart';
import '../core/state/game_provider.dart';
import '../core/theme/roomie_theme.dart';
import '../models/game_state.dart';

class MafiaGameView extends ConsumerWidget {
  const MafiaGameView({super.key, required this.roomId, required this.envelope});
  final String roomId;
  final GameStateEnvelope envelope;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = envelope.asMafiaState();
    final authState = ref.watch(authProvider);
    final myUserId = authState is AuthAuthenticated ? authState.user.id : null;
    final isNight = envelope.phase == 'night';
    final isDayVoting = envelope.phase == 'day_voting';

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (state.winner != null)
            _WinnerBanner(winner: state.winner!)
          else
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text(
                      isNight ? 'Night falls...' : 'Round ${state.round} - ${_phaseLabel(envelope.phase)}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (state.myRole != null) ...[
                      const SizedBox(height: 6),
                      Text('Your role: ${state.myRole}', style: const TextStyle(color: RoomieColors.accent)),
                    ],
                    if (state.lastNightResult != null && envelope.phase != 'night') ...[
                      const SizedBox(height: 8),
                      Text(
                        state.lastNightResult!['killedId'] != null
                            ? '${state.lastNightResult!['killedId']} was eliminated during the night'
                            : 'Nobody was eliminated - the doctor saved them',
                        style: const TextStyle(color: RoomieColors.textSecondary, fontSize: 13),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          const SizedBox(height: 16),
          Expanded(
            child: ListView(
              children: state.players.values.map((p) {
                final isSelf = p.id == myUserId;
                final canTargetAtNight = isNight && state.myRole != null && state.myRole != 'villager' && !isSelf && p.alive;
                final canVoteAtDay = isDayVoting && !isSelf && p.alive && state.myDayVote == null;

                return Card(
                  child: ListTile(
                    enabled: p.alive,
                    title: Text(isSelf ? '${p.id} (You)' : p.id),
                    subtitle: p.role != null ? Text('Role: ${p.role}') : (!p.alive ? const Text('Eliminated') : null),
                    trailing: canTargetAtNight
                        ? _NightActionButton(roomId: roomId, myRole: state.myRole!, targetId: p.id)
                        : canVoteAtDay
                            ? OutlinedButton(
                                onPressed: () => ref.read(gameControllerProvider.notifier).mafiaDayVote(roomId, p.id),
                                child: const Text('Vote'),
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

  String _phaseLabel(String phase) => switch (phase) {
        'day_discussion' => 'Discussion',
        'day_voting' => 'Voting',
        'day_reveal' => 'Reveal',
        _ => phase,
      };
}

class _NightActionButton extends ConsumerWidget {
  const _NightActionButton({required this.roomId, required this.myRole, required this.targetId});
  final String roomId;
  final String myRole;
  final String targetId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final actionType = switch (myRole) {
      'mafia' => 'mafia_vote',
      'detective' => 'detective_check',
      'doctor' => 'doctor_protect',
      _ => null,
    };
    if (actionType == null) return const SizedBox.shrink();

    final label = switch (myRole) {
      'mafia' => 'Kill',
      'detective' => 'Check',
      'doctor' => 'Protect',
      _ => 'Act',
    };

    return OutlinedButton(
      onPressed: () => ref.read(gameControllerProvider.notifier).mafiaNightAction(roomId, actionType, targetId),
      child: Text(label),
    );
  }
}

class _WinnerBanner extends StatelessWidget {
  const _WinnerBanner({required this.winner});
  final String winner;

  @override
  Widget build(BuildContext context) {
    final villagersWon = winner == 'villagers';
    return Card(
      color: villagersWon ? RoomieColors.success.withOpacity(0.12) : RoomieColors.danger.withOpacity(0.12),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Icon(villagersWon ? Icons.groups : Icons.dark_mode, size: 32),
            const SizedBox(height: 8),
            Text(villagersWon ? 'Villagers win!' : 'Mafia wins!', style: Theme.of(context).textTheme.titleLarge),
          ],
        ),
      ),
    );
  }
}
