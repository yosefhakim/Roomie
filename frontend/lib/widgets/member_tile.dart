import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../core/theme/roomie_theme.dart';
import '../models/room.dart';
import 'avatar_3d_viewer.dart';

class MemberTile extends StatelessWidget {
  const MemberTile({
    super.key,
    required this.member,
    required this.isSpeaking,
    required this.isSelf,
    this.onTapGift,
    this.onTapMute,
    this.onTapKick,
    this.onTapPromote,
  });

  final RoomMember member;
  final bool isSpeaking;
  final bool isSelf;
  final VoidCallback? onTapGift;
  final VoidCallback? onTapMute;
  final VoidCallback? onTapKick;
  final VoidCallback? onTapPromote;

  void _showMenu(BuildContext context) {
    if (onTapMute == null && onTapKick == null && onTapPromote == null) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: RoomieColors.surfaceRaised,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (onTapMute != null)
              ListTile(
                leading: Icon(member.muted ? Icons.mic : Icons.mic_off, color: RoomieColors.textPrimary),
                title: Text(member.muted ? 'Unmute' : 'Mute'),
                onTap: () {
                  Navigator.pop(context);
                  onTapMute!();
                },
              ),
            if (onTapPromote != null)
              ListTile(
                leading: const Icon(Icons.arrow_upward, color: RoomieColors.textPrimary),
                title: const Text('Promote to speaker'),
                onTap: () {
                  Navigator.pop(context);
                  onTapPromote!();
                },
              ),
            if (onTapKick != null)
              ListTile(
                leading: const Icon(Icons.person_remove_outlined, color: RoomieColors.danger),
                title: const Text('Kick from room', style: TextStyle(color: RoomieColors.danger)),
                onTap: () {
                  Navigator.pop(context);
                  onTapKick!();
                },
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTapGift,
      onLongPress: () => _showMenu(context),
      child: Column(
        children: [
          Expanded(
            child: Stack(
              alignment: Alignment.center,
              children: [
                // Speaking ring: an animated glow that only renders while
                // isSpeaking is true, driven by the voice:activity relay
                // (see core/state/voice_provider.dart). This is the
                // concrete Layer 6->7 payoff: Agora's client-side VAD ->
                // socket relay -> this animation, with the server never
                // touching audio content itself.
                if (isSpeaking)
                  Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: RoomieColors.success, width: 3),
                    ),
                  ).animate(onPlay: (c) => c.repeat(reverse: true)).scale(
                        begin: const Offset(1, 1),
                        end: const Offset(1.08, 1.08),
                        duration: 500.ms,
                      ),
                Avatar3DViewer(userId: member.userId, size: 60),
                if (member.handRaised)
                  const Positioned(
                    top: -4,
                    right: -4,
                    child: CircleAvatar(
                      radius: 11,
                      backgroundColor: RoomieColors.warning,
                      child: Icon(Icons.back_hand, size: 12, color: Colors.black87),
                    ),
                  ),
                if (member.muted && member.role != 'listener')
                  const Positioned(
                    bottom: -2,
                    right: -2,
                    child: CircleAvatar(
                      radius: 10,
                      backgroundColor: RoomieColors.danger,
                      child: Icon(Icons.mic_off, size: 11, color: Colors.white),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          Text(
            member.displayName + (isSelf ? ' (You)' : ''),
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          if (member.role == 'owner' || member.role == 'admin')
            Text(
              member.role == 'owner' ? 'Owner' : 'Admin',
              style: const TextStyle(fontSize: 10, color: RoomieColors.accent, fontWeight: FontWeight.w600),
            ),
        ],
      ),
    );
  }
}
