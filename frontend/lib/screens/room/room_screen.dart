import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/state/auth_provider.dart';
import '../../core/state/room_provider.dart';
import '../../core/state/voice_provider.dart';
import '../../core/state/wallet_provider.dart';
import '../../core/theme/roomie_theme.dart';
import '../../models/room.dart';
import '../../widgets/member_tile.dart';
import '../../widgets/game_launch_sheet.dart';
import '../../widgets/gift_picker_sheet.dart';

class RoomScreen extends ConsumerStatefulWidget {
  const RoomScreen({super.key, required this.roomId});
  final String roomId;

  @override
  ConsumerState<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  @override
  void initState() {
    super.initState();
    // Voice join is fire-and-forget from the UI's perspective: if it fails
    // (e.g. mic permission denied, Agora not configured), the room itself
    // is still fully usable - voice is additive, not a hard requirement to
    // be in a room. Errors are surfaced via a snackbar rather than blocking
    // navigation into the room.
    WidgetsBinding.instance.addPostFrameCallback((_) => _joinVoice());
  }

  Future<void> _joinVoice() async {
    try {
      await ref.read(voiceControllerProvider.notifier).joinRoomVoice(widget.roomId);
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Voice chat unavailable: $err')));
      }
    }
  }

  @override
  void dispose() {
    ref.read(voiceControllerProvider.notifier).leaveRoomVoice();
    super.dispose();
  }

  Future<void> _leaveRoom() async {
    await ref.read(roomControllerProvider.notifier).leaveRoom(widget.roomId);
    if (mounted) context.go('/lobby');
  }

  Future<void> _showGameLaunchSheet() async {
    await showModalBottomSheet(
      context: context,
      backgroundColor: RoomieColors.surfaceRaised,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => GameLaunchSheet(roomId: widget.roomId),
    );
  }

  Future<void> _showGiftPicker(String receiverId, String receiverName) async {
    await showModalBottomSheet(
      context: context,
      backgroundColor: RoomieColors.surfaceRaised,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => GiftPickerSheet(roomId: widget.roomId, receiverId: receiverId, receiverName: receiverName),
    );
  }

  @override
  Widget build(BuildContext context) {
    final room = ref.watch(roomControllerProvider);
    final voiceState = ref.watch(voiceControllerProvider);
    final currentUser = ref.watch(authProvider);
    final myUserId = currentUser is AuthAuthenticated ? currentUser.user.id : null;

    // The room controller's state is populated by the 'room:state' socket
    // broadcast (see core/state/room_provider.dart) - if it's still null
    // this early, we're either mid-join or the join failed; either way,
    // show a loading state rather than a broken empty room UI.
    if (room == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    RoomMember? myMember;
    for (final m in room.members) {
      if (m.userId == myUserId) {
        myMember = m;
        break;
      }
    }
    final isOwnerOrAdmin = myMember?.role == 'owner' || myMember?.role == 'admin';

    return Scaffold(
      appBar: AppBar(
        title: Text(room.name),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: _leaveRoom),
        actions: const [_WalletBadge(), SizedBox(width: 8)],
      ),
      body: Column(
        children: [
          Expanded(
            child: GridView.builder(
              padding: const EdgeInsets.all(16),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisSpacing: 16,
                crossAxisSpacing: 12,
                childAspectRatio: 0.8,
              ),
              itemCount: room.members.length,
              itemBuilder: (context, index) {
                final member = room.members[index];
                final isSpeaking = voiceState.speakingUsers[member.userId]?.isSpeaking ?? false;
                return MemberTile(
                  member: member,
                  isSpeaking: isSpeaking,
                  isSelf: member.userId == myUserId,
                  onTapGift: member.userId == myUserId ? null : () => _showGiftPicker(member.userId, member.displayName),
                  onTapMute: isOwnerOrAdmin || member.userId == myUserId
                      ? () => ref.read(roomControllerProvider.notifier).setMute(widget.roomId, member.userId, !member.muted)
                      : null,
                  onTapKick: isOwnerOrAdmin && member.userId != myUserId
                      ? () => ref.read(roomControllerProvider.notifier).kick(widget.roomId, member.userId)
                      : null,
                  onTapPromote: isOwnerOrAdmin && member.role == 'listener'
                      ? () => ref.read(roomControllerProvider.notifier).setRole(widget.roomId, member.userId, 'speaker')
                      : null,
                );
              },
            ),
          ),
          _RoomControlBar(roomId: widget.roomId, myMember: myMember, onStartGame: _showGameLaunchSheet),
        ],
      ),
    );
  }
}

class _WalletBadge extends ConsumerStatefulWidget {
  const _WalletBadge();

  @override
  ConsumerState<_WalletBadge> createState() => _WalletBadgeState();
}

class _WalletBadgeState extends ConsumerState<_WalletBadge> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(walletControllerProvider.notifier).refresh());
  }

  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(walletControllerProvider);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: RoomieColors.surfaceOverlay, borderRadius: BorderRadius.circular(20)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.monetization_on, size: 16, color: RoomieColors.warning),
          const SizedBox(width: 4),
          Text('${wallet?.coins ?? '—'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _RoomControlBar extends ConsumerWidget {
  const _RoomControlBar({required this.roomId, required this.myMember, required this.onStartGame});

  final String roomId;
  final RoomMember? myMember;
  final VoidCallback onStartGame;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final voiceState = ref.watch(voiceControllerProvider);
    final isOwner = myMember?.role == 'owner';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: RoomieColors.surfaceRaised,
        border: Border(top: BorderSide(color: RoomieColors.surfaceBorder)),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            if (voiceState.canPublish)
              IconButton.filled(
                onPressed: () => ref.read(voiceControllerProvider.notifier).toggleSelfMute(),
                icon: Icon(voiceState.selfMuted ? Icons.mic_off : Icons.mic),
                style: IconButton.styleFrom(
                  backgroundColor: voiceState.selfMuted ? RoomieColors.danger.withOpacity(0.15) : RoomieColors.accentMuted,
                  foregroundColor: voiceState.selfMuted ? RoomieColors.danger : RoomieColors.accent,
                ),
              )
            else
              IconButton(
                onPressed: () =>
                    ref.read(roomControllerProvider.notifier).raiseHand(roomId, !(myMember?.handRaised ?? false)),
                icon: Icon(
                  Icons.back_hand_outlined,
                  color: (myMember?.handRaised ?? false) ? RoomieColors.warning : RoomieColors.textSecondary,
                ),
              ),
            const Spacer(),
            if (isOwner)
              ElevatedButton.icon(
                onPressed: onStartGame,
                icon: const Icon(Icons.sports_esports_outlined, size: 18),
                label: const Text('Play a game'),
              ),
          ],
        ),
      ),
    );
  }
}
