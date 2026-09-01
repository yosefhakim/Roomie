import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/state/auth_provider.dart';
import '../../core/state/wallet_provider.dart';
import '../../core/theme/roomie_theme.dart';
import '../../widgets/avatar_3d_viewer.dart';
import '../avatar/avatar_customization_screen.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _claimingDaily = false;
  String? _dailyResultMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(walletControllerProvider.notifier).refresh());
  }

  Future<void> _claimDaily() async {
    setState(() => _claimingDaily = true);
    try {
      // POST /api/economy/daily-reward/claim - see
      // backend/src/services/dailyRewardService.js. Returns 400
      // ALREADY_CLAIMED if today's reward was already taken; that's
      // surfaced here as a friendly message rather than a raw error.
      final result = await ref.read(walletControllerProvider.notifier).claimDailyReward();
      setState(() => _dailyResultMessage = 'Day ${result['streakDay']} streak: +${result['coinsAwarded']} coins!');
    } catch (err) {
      final message = err.toString().contains('ALREADY_CLAIMED')
          ? "You've already claimed today's reward"
          : 'Could not claim reward right now';
      setState(() => _dailyResultMessage = message);
    } finally {
      if (mounted) setState(() => _claimingDaily = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final wallet = ref.watch(walletControllerProvider);
    final user = authState is AuthAuthenticated ? authState.user : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: user == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Center(
                  child: Column(
                    children: [
                      Avatar3DViewer(userId: user.id, size: 96, modelUrl: user.avatarUrl),
                      const SizedBox(height: 12),
                      Text(user.displayName, style: Theme.of(context).textTheme.titleLarge),
                      Text('@${user.username}', style: const TextStyle(color: RoomieColors.textSecondary)),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => const AvatarCustomizationScreen()),
                        ),
                        icon: const Icon(Icons.face_retouching_natural, size: 18),
                        label: const Text('Customize avatar'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        _WalletStat(
                          label: 'Coins',
                          value: '${wallet?.coins ?? '—'}',
                          icon: Icons.monetization_on,
                          color: RoomieColors.warning,
                        ),
                        const SizedBox(width: 16),
                        _WalletStat(
                          label: 'Diamonds',
                          value: '${wallet?.diamonds ?? '—'}',
                          icon: Icons.diamond,
                          color: RoomieColors.accent,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text('Daily Reward', style: TextStyle(fontWeight: FontWeight.w600)),
                        const SizedBox(height: 4),
                        const Text(
                          'Claim once a day - streaks earn bigger rewards',
                          style: TextStyle(fontSize: 12, color: RoomieColors.textSecondary),
                        ),
                        const SizedBox(height: 12),
                        ElevatedButton(
                          onPressed: _claimingDaily ? null : _claimDaily,
                          child: _claimingDaily
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const Text("Claim today's reward"),
                        ),
                        if (_dailyResultMessage != null) ...[
                          const SizedBox(height: 8),
                          Text(_dailyResultMessage!, style: const TextStyle(fontSize: 13, color: RoomieColors.success)),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                OutlinedButton.icon(
                  onPressed: () async {
                    await ref.read(authProvider.notifier).logout();
                    if (context.mounted) context.go('/login');
                  },
                  icon: const Icon(Icons.logout, color: RoomieColors.danger),
                  label: const Text('Log out', style: TextStyle(color: RoomieColors.danger)),
                ),
              ],
            ),
    );
  }
}

class _WalletStat extends StatelessWidget {
  const _WalletStat({required this.label, required this.value, required this.icon, required this.color});
  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
              Text(label, style: const TextStyle(fontSize: 11, color: RoomieColors.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }
}
