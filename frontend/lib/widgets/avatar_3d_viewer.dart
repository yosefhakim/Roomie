import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../core/theme/roomie_theme.dart';

/// Renders a 3D avatar (glTF/GLB model, e.g. from Ready Player Me) for a
/// given user.
///
/// DESIGN RATIONALE - why WebView + Three.js instead of a native Flutter 3D
/// engine:
///
/// Flutter has no first-party 3D rendering API. The realistic options for
/// "render a glTF avatar in Flutter" are:
///   1. A native package like `flutter_3d_controller` or `model_viewer_plus`
///      (both are themselves WebView-based under the hood for glTF/GLB on
///      most platforms, or wrap platform-native SceneKit/Filament code)
///   2. Hosting a minimal Three.js scene inside a WebView ourselves, with
///      a thin JS<->Dart bridge for the few things the app actually needs
///      (loading a specific model URL, playing idle/talking/emote
///      animations, receiving a "loaded" callback)
///   3. A Flutter-native rendering engine (e.g. building on `flutter_gpu`/
///      Impeller directly) - by far the most work, and not a good fit for
///      a small avatar viewer used in many small tiles simultaneously
///      (performance of N simultaneous native 3D contexts in a grid is a
///      real concern `model_viewer_plus`-style solutions already navigate)
///
/// This implementation takes option 2 directly rather than pulling in a
/// third-party wrapper, so the exact JS bridge contract is visible and
/// auditable in one file (assets/avatar_viewer/index.html) instead of
/// hidden inside a dependency. The tradeoff is real: WebView-hosted 3D has
/// higher per-instance memory/CPU cost than a single shared native
/// renderer would, which matters when this widget appears many times in a
/// room grid - see the honest-limitations note in the frontend README
/// about this being genuinely unverified and worth load-testing before
/// shipping with many simultaneous avatars on screen.
class Avatar3DViewer extends StatefulWidget {
  const Avatar3DViewer({
    super.key,
    required this.userId,
    this.size = 64,
    this.modelUrl,
    this.animationState = AvatarAnimationState.idle,
  });

  final String userId;
  final double size;

  /// Ready Player Me (or any glTF/GLB) model URL. If null, the viewer
  /// renders a static placeholder silhouette instead of attempting to load
  /// a model - see _buildPlaceholder below.
  final String? modelUrl;
  final AvatarAnimationState animationState;

  @override
  State<Avatar3DViewer> createState() => _Avatar3DViewerState();
}

enum AvatarAnimationState { idle, talking, waving, celebrating }

class _Avatar3DViewerState extends State<Avatar3DViewer> {
  WebViewController? _controller;
  bool _loaded = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    if (widget.modelUrl != null) {
      _initWebView();
    }
  }

  Future<void> _initWebView() async {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel(
        'RoomieAvatarBridge',
        onMessageReceived: (message) {
          // The page posts JSON messages like {"type":"loaded"} or
          // {"type":"error","message":"..."} - see
          // assets/avatar_viewer/index.html's postToFlutter() calls.
          try {
            final data = jsonDecode(message.message) as Map<String, dynamic>;
            if (data['type'] == 'loaded' && mounted) {
              setState(() => _loaded = true);
            } else if (data['type'] == 'error' && mounted) {
              setState(() => _failed = true);
            }
          } catch (_) {
            // Malformed bridge message - ignore rather than crash the tile.
          }
        },
      )
      ..setNavigationDelegate(NavigationDelegate(
        onWebResourceError: (error) {
          if (mounted) setState(() => _failed = true);
        },
      ))
      ..loadFlutterAsset('assets/avatar_viewer/index.html');

    setState(() => _controller = controller);

    // Give the page a moment to initialize Three.js before pushing the
    // model URL into it via the bridge - a production build would instead
    // wait for an explicit "ready" postMessage before calling this; this
    // fixed delay is a simplification flagged in the honest-limitations
    // section of the frontend README.
    await Future.delayed(const Duration(milliseconds: 300));
    await _sendToPage({'type': 'loadModel', 'url': widget.modelUrl});
  }

  @override
  void didUpdateWidget(covariant Avatar3DViewer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.animationState != widget.animationState) {
      _sendToPage({'type': 'setAnimation', 'state': widget.animationState.name});
    }
  }

  Future<void> _sendToPage(Map<String, dynamic> message) async {
    if (_controller == null) return;
    final json = jsonEncode(message);
    await _controller!.runJavaScript('window.receiveFromFlutter($json)');
  }

  @override
  Widget build(BuildContext context) {
    final size = widget.size;

    if (widget.modelUrl == null || _failed) {
      return _buildPlaceholder(size);
    }

    return ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: Stack(
          children: [
            if (_controller != null) WebViewWidget(controller: _controller!),
            if (!_loaded) Center(child: _buildPlaceholder(size, transparent: true)),
          ],
        ),
      ),
    );
  }

  /// Fallback shown before a model loads, on load failure, or when no
  /// modelUrl is set (e.g. a user hasn't customized an avatar yet) - an
  /// initial-letter circle, consistent with the admin dashboard's avatar
  /// treatment (see admin-dashboard's AppShell.jsx user badge).
  Widget _buildPlaceholder(double size, {bool transparent = false}) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: transparent ? Colors.transparent : RoomieColors.accentMuted,
      ),
      child: transparent
          ? null
          : Center(
              child: Text(
                widget.userId.isNotEmpty ? widget.userId[0].toUpperCase() : '?',
                style: TextStyle(color: RoomieColors.accent, fontWeight: FontWeight.bold, fontSize: size * 0.4),
              ),
            ),
    );
  }
}
