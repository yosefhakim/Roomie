import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/state/game_provider.dart';
import '../core/theme/roomie_theme.dart';

class GameLaunchSheet extends ConsumerStatefulWidget {
  const GameLaunchSheet({super.key, required this.roomId});
  final String roomId;

  @override
  ConsumerState<GameLaunchSheet> createState() => _GameLaunchSheetState();
}

class _GameLaunchSheetState extends ConsumerState<GameLaunchSheet> {
  bool _starting = false;

  Future<void> _start(String gameType) async {
    setState(() => _starting = true);
    try {
      final result = await ref.read(gameControllerProvider.notifier).startGame(widget.roomId, gameType);
      if (result['ok'] == true && mounted) {
        Navigator.of(context).pop();
        context.push('/room/${widget.roomId}/game');
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not start game: $err')));
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Choose a game', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            _GameOption(
              title: "Who's the Spy",
              subtitle: 'Find the impostor before they blend in',
              icon: Icons.visibility_off_outlined,
              enabled: !_starting,
              onTap: () => _start('spy'),
            ),
            const SizedBox(height: 10),
            _GameOption(
              title: 'Mafia',
              subtitle: 'Day and night phases, hidden roles',
              icon: Icons.nightlight_round,
              enabled: !_starting,
              onTap: () => _start('mafia'),
            ),
            const SizedBox(height: 10),
            _GameOption(
              title: 'Draw & Guess',
              subtitle: 'Sketch it, guess it, score points',
              icon: Icons.brush_outlined,
              enabled: !_starting,
              onTap: () => _start('draw_guess'),
            ),
          ],
        ),
      ),
    );
  }
}

class _GameOption extends StatelessWidget {
  const _GameOption({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: enabled ? onTap : null,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: RoomieColors.surfaceOverlay,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: RoomieColors.surfaceBorder),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: RoomieColors.accentMuted, borderRadius: BorderRadius.circular(12)),
              child: Icon(icon, color: RoomieColors.accent),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(subtitle, style: const TextStyle(fontSize: 12, color: RoomieColors.textSecondary)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: RoomieColors.textSecondary),
          ],
        ),
      ),
    );
  }
}
