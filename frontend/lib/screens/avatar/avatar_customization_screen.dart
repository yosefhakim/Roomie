import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/state/core_providers.dart';
import '../../core/theme/roomie_theme.dart';
import '../../widgets/avatar_3d_viewer.dart';

/// Avatar customization here means: pick from a curated set of pre-made
/// Ready Player Me avatar URLs and save the selection to the user's
/// profile. It deliberately does NOT implement a full in-app sculpting UI
/// (face shape, hair, clothing sliders, etc.) - that's Ready Player Me's
/// own hosted avatar creator, which apps typically embed via a WebView
/// pointed at RPM's creator URL and capture the resulting model URL from a
/// postMessage callback when the user finishes. That embed flow is a
/// substantial feature on its own (RPM subdomain setup, the creator
/// iframe's message contract, photo-to-avatar upload permissions) and is
/// called out explicitly as NOT built here - see the frontend README's
/// honest-limitations section. What IS real: the preset-selection flow
/// end-to-end and the live 3D preview using the same Avatar3DViewer the
/// rest of the app uses.
class AvatarCustomizationScreen extends ConsumerStatefulWidget {
  const AvatarCustomizationScreen({super.key});

  @override
  ConsumerState<AvatarCustomizationScreen> createState() => _AvatarCustomizationScreenState();
}

// A small set of publicly-known Ready Player Me sample avatar URLs, used
// as stand-ins for "your organization's curated preset library" - in a
// real deployment these would come from your own RPM subdomain's asset
// list or a backend-served catalog, not be hardcoded like this.
const _presetAvatars = [
  'https://models.readyplayer.me/64f1a714fe61576b510d7500.glb',
  'https://models.readyplayer.me/64f1a7f9fe61576b510d7521.glb',
  'https://models.readyplayer.me/64f1a856fe61576b510d7532.glb',
];

class _AvatarCustomizationScreenState extends ConsumerState<AvatarCustomizationScreen> {
  String? _selectedUrl;
  bool _saving = false;

  Future<void> _save() async {
    if (_selectedUrl == null) return;
    setState(() => _saving = true);
    try {
      // NOTE: there is no dedicated "update avatar" backend endpoint built
      // in Layers 1-6 - user profile fields beyond what's set at
      // registration (email/username/displayName/passwordHash) were never
      // added to the users table or an update route. This call documents
      // the intended contract (PATCH /api/users/me with { avatarUrl }) but
      // WILL 404 against the backend as currently built. Flagged plainly
      // here and in the frontend README rather than silently succeeding
      // against a nonexistent endpoint.
      await ref.read(apiClientProvider).dio.patch('/api/users/me', data: {'avatarUrl': _selectedUrl});
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              "Saving isn't wired up yet - PATCH /api/users/me doesn't exist on the backend. See the frontend README.",
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Customize avatar')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Avatar3DViewer(userId: 'preview', size: 140, modelUrl: _selectedUrl),
            const SizedBox(height: 24),
            const Text('Choose a preset', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            Expanded(
              child: GridView.builder(
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  mainAxisSpacing: 16,
                  crossAxisSpacing: 16,
                ),
                itemCount: _presetAvatars.length,
                itemBuilder: (context, index) {
                  final url = _presetAvatars[index];
                  final selected = _selectedUrl == url;
                  return GestureDetector(
                    onTap: () => setState(() => _selectedUrl = url),
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: selected ? RoomieColors.accent : Colors.transparent, width: 3),
                      ),
                      child: Avatar3DViewer(userId: 'preset_$index', size: 88, modelUrl: url),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _selectedUrl == null || _saving ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Save avatar'),
            ),
          ],
        ),
      ),
    );
  }
}
