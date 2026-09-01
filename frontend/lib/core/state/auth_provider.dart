import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/user.dart';
import 'core_providers.dart';

sealed class AuthState {
  const AuthState();
}

class AuthInitial extends AuthState {
  const AuthInitial();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class AuthAuthenticated extends AuthState {
  const AuthAuthenticated(this.user);
  final RoomieUser user;
}

class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated({this.errorMessage});
  final String? errorMessage;
}

/// Mirrors the request/response shapes of backend/src/routes/auth.js
/// exactly - one method per endpoint. On success, tokens are persisted via
/// TokenStorage and the socket connection is (re)established so the room
/// layer immediately has a live connection using the fresh token.
class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._ref) : super(const AuthInitial()) {
    _bootstrap();
  }

  final Ref _ref;

  Future<void> _bootstrap() async {
    final tokenStorage = _ref.read(tokenStorageProvider);
    final accessToken = await tokenStorage.getAccessToken();
    if (accessToken == null) {
      state = const AuthUnauthenticated();
      return;
    }
    // A stored token doesn't guarantee validity (could be expired/revoked).
    // We optimistically move to "loading" and let the first authenticated
    // API call's 401-refresh-retry cycle (ApiClient) sort it out; if that
    // also fails, ApiClient clears storage and callers should observe an
    // unauthenticated state on next explicit auth action. A production
    // app would likely add a lightweight GET /api/auth/me here to resolve
    // this deterministically at startup - not present in the Layer 2
    // backend as built; see backend README's honest-limitations section.
    state = const AuthLoading();
    await connectSocket();
  }

  Future<void> connectSocket() async {
    await _ref.read(socketManagerProvider).connect();
  }

  Future<bool> login({required String email, required String password}) async {
    state = const AuthLoading();
    try {
      final response = await _ref.read(apiClientProvider).dio.post('/api/auth/login', data: {
        'email': email,
        'password': password,
      });
      await _persistSessionAndConnect(response.data);
      return true;
    } catch (err) {
      state = AuthUnauthenticated(errorMessage: _extractErrorMessage(err));
      return false;
    }
  }

  Future<bool> register({
    required String email,
    required String username,
    required String password,
    String? displayName,
  }) async {
    state = const AuthLoading();
    try {
      final response = await _ref.read(apiClientProvider).dio.post('/api/auth/register', data: {
        'email': email,
        'username': username,
        'password': password,
        if (displayName != null) 'displayName': displayName,
      });
      await _persistSessionAndConnect(response.data);
      return true;
    } catch (err) {
      state = AuthUnauthenticated(errorMessage: _extractErrorMessage(err));
      return false;
    }
  }

  /// [idToken] comes from the native Google Sign-In SDK flow, which is
  /// itself outside this file's scope (a platform integration handled by a
  /// package like google_sign_in) - this method only handles exchanging
  /// that ID token with our backend per POST /api/auth/oauth/google.
  Future<bool> loginWithGoogle(String idToken) async {
    state = const AuthLoading();
    try {
      final response = await _ref.read(apiClientProvider).dio.post('/api/auth/oauth/google', data: {
        'idToken': idToken,
      });
      await _persistSessionAndConnect(response.data);
      return true;
    } catch (err) {
      state = AuthUnauthenticated(errorMessage: _extractErrorMessage(err));
      return false;
    }
  }

  /// [fullName] must be captured from Apple's native sign-in sheet on
  /// FIRST authorization only - Apple does not provide it on subsequent
  /// sign-ins, a limitation of Sign in with Apple itself, not this app.
  /// See backend README's Layer 2 honest-limitations note for the
  /// server-side half of this constraint.
  Future<bool> loginWithApple(String identityToken, {String? fullName}) async {
    state = const AuthLoading();
    try {
      final response = await _ref.read(apiClientProvider).dio.post('/api/auth/oauth/apple', data: {
        'identityToken': identityToken,
        if (fullName != null) 'fullName': fullName,
      });
      await _persistSessionAndConnect(response.data);
      return true;
    } catch (err) {
      state = AuthUnauthenticated(errorMessage: _extractErrorMessage(err));
      return false;
    }
  }

  Future<void> logout() async {
    final tokenStorage = _ref.read(tokenStorageProvider);
    final refreshToken = await tokenStorage.getRefreshToken();
    if (refreshToken != null) {
      try {
        await _ref.read(apiClientProvider).dio.post('/api/auth/logout', data: {'refreshToken': refreshToken});
      } catch (_) {
        // Best-effort server-side revocation; local logout proceeds
        // regardless so the user is never stuck unable to log out due to a
        // network blip.
      }
    }
    await tokenStorage.clear();
    _ref.read(socketManagerProvider).disconnect();
    state = const AuthUnauthenticated();
  }

  Future<void> _persistSessionAndConnect(Map<String, dynamic> responseData) async {
    final tokenStorage = _ref.read(tokenStorageProvider);
    await tokenStorage.saveTokens(
      accessToken: responseData['accessToken'] as String,
      refreshToken: responseData['refreshToken'] as String,
    );
    final user = RoomieUser.fromJson(Map<String, dynamic>.from(responseData['user'] as Map));
    state = AuthAuthenticated(user);
    await connectSocket();
  }

  String? _extractErrorMessage(Object err) {
    // DioException's response.data follows the { error, message } shape
    // every backend route in this project returns on failure (see e.g.
    // routes/auth.js's handleAuthError).
    try {
      final dynamic data = (err as dynamic).response?.data;
      if (data is Map && data['message'] != null) return data['message'] as String;
    } catch (_) {}
    return 'Something went wrong. Please try again.';
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier(ref));
