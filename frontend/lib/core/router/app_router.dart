import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../state/auth_provider.dart';
import '../../screens/auth/login_screen.dart';
import '../../screens/auth/register_screen.dart';
import '../../screens/lobby/lobby_screen.dart';
import '../../screens/room/room_screen.dart';
import '../../screens/game/game_screen.dart';
import '../../screens/profile/profile_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/lobby',
    redirect: (context, state) {
      final authState = ref.read(authProvider);
      final isAuthRoute = state.matchedLocation == '/login' || state.matchedLocation == '/register';

      if (authState is AuthUnauthenticated && !isAuthRoute) return '/login';
      if (authState is AuthAuthenticated && isAuthRoute) return '/lobby';
      return null;
    },
    refreshListenable: _AuthStateListenable(ref),
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(path: '/register', builder: (context, state) => const RegisterScreen()),
      GoRoute(path: '/lobby', builder: (context, state) => const LobbyScreen()),
      GoRoute(
        path: '/room/:roomId',
        builder: (context, state) => RoomScreen(roomId: state.pathParameters['roomId']!),
        routes: [
          GoRoute(
            path: 'game',
            builder: (context, state) => GameScreen(roomId: state.pathParameters['roomId']!),
          ),
        ],
      ),
      GoRoute(path: '/profile', builder: (context, state) => const ProfileScreen()),
    ],
  );
});

/// Bridges Riverpod's authProvider changes into go_router's Listenable-based
/// refresh mechanism, so a login/logout immediately re-evaluates `redirect`
/// above without requiring a manual navigation call from every auth action.
class _AuthStateListenable extends ChangeNotifier {
  _AuthStateListenable(this._ref) {
    _ref.listen(authProvider, (_, __) => notifyListeners());
  }
  final Ref _ref;
}
