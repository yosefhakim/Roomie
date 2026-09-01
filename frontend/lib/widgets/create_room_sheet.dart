import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/state/room_provider.dart';
import '../core/theme/roomie_theme.dart';

class CreateRoomSheet extends ConsumerStatefulWidget {
  const CreateRoomSheet({super.key});

  @override
  ConsumerState<CreateRoomSheet> createState() => _CreateRoomSheetState();
}

class _CreateRoomSheetState extends ConsumerState<CreateRoomSheet> {
  final _nameController = TextEditingController();
  String _visibility = 'public';
  bool _submitting = false;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) return;

    setState(() => _submitting = true);
    try {
      final result = await ref.read(roomControllerProvider.notifier).createRoom(name: name, visibility: _visibility);
      if (result['ok'] == true && mounted) {
        Navigator.of(context).pop(result['room']['id'] as String);
      }
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to create room: $err')));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(color: RoomieColors.surfaceBorder, borderRadius: BorderRadius.circular(2)),
            ),
          ),
          const SizedBox(height: 20),
          Text('Create a room', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 20),
          TextField(
            controller: _nameController,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Room name', hintText: 'Friday night hangout'),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              _VisibilityChip(
                label: 'Public',
                icon: Icons.public,
                selected: _visibility == 'public',
                onTap: () => setState(() => _visibility = 'public'),
              ),
              const SizedBox(width: 8),
              _VisibilityChip(
                label: 'Private',
                icon: Icons.lock_outline,
                selected: _visibility == 'private',
                onTap: () => setState(() => _visibility = 'private'),
              ),
            ],
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Create'),
          ),
        ],
      ),
    );
  }
}

class _VisibilityChip extends StatelessWidget {
  const _VisibilityChip({required this.label, required this.icon, required this.selected, required this.onTap});

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: selected ? RoomieColors.accentMuted : RoomieColors.surfaceOverlay,
            border: Border.all(color: selected ? RoomieColors.accent : RoomieColors.surfaceBorder),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Icon(icon, size: 18, color: selected ? RoomieColors.accent : RoomieColors.textSecondary),
              const SizedBox(height: 4),
              Text(label, style: TextStyle(fontSize: 13, color: selected ? RoomieColors.accent : RoomieColors.textSecondary)),
            ],
          ),
        ),
      ),
    );
  }
}
