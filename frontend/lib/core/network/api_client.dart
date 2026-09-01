import 'package:dio/dio.dart';
import 'token_storage.dart';

/// Base URL is injected at build time via --dart-define, so the same build
/// artifact isn't hardcoded to one environment:
///   flutter run --dart-define=API_BASE_URL=http://localhost:4000
const _defaultBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:4000',
);

/// Wraps Dio with:
///  - automatic Bearer token attachment
///  - automatic single-flight refresh-and-retry on 401 (mirrors the exact
///    pattern used in admin-dashboard/src/lib/api.js, so both clients
///    behave identically against the same backend contract)
class ApiClient {
  ApiClient({String? baseUrl, TokenStorage? tokenStorage})
      : _tokenStorage = tokenStorage ?? TokenStorage(),
        dio = Dio(BaseOptions(
          baseUrl: baseUrl ?? _defaultBaseUrl,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 15),
        )) {
    dio.interceptors.add(_authInterceptor());
  }

  final Dio dio;
  final TokenStorage _tokenStorage;
  Future<String?>? _refreshInFlight;

  InterceptorsWrapper _authInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _tokenStorage.getAccessToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (error, handler) async {
        final isAuthFailure = error.response?.statusCode == 401 &&
            error.requestOptions.extra['retried'] != true &&
            error.response?.data is Map &&
            (error.response?.data as Map)['error'] != 'ACCOUNT_BANNED';

        if (!isAuthFailure) {
          return handler.next(error);
        }

        try {
          final newAccessToken = await _refreshAccessToken();
          if (newAccessToken == null) throw Exception('No refresh token available');

          final retryOptions = error.requestOptions;
          retryOptions.extra['retried'] = true;
          retryOptions.headers['Authorization'] = 'Bearer $newAccessToken';

          final response = await dio.fetch(retryOptions);
          return handler.resolve(response);
        } catch (_) {
          await _tokenStorage.clear();
          // The auth-state provider (see core/state/auth_provider.dart)
          // listens for this and redirects to the login screen; the
          // network layer itself does not perform navigation.
          return handler.next(error);
        }
      },
    );
  }

  /// Single-flight refresh: concurrent 401s share one refresh call rather
  /// than each firing their own (same principle as the admin dashboard's
  /// api.js interceptor).
  Future<String?> _refreshAccessToken() {
    return _refreshInFlight ??= _performRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<String?> _performRefresh() async {
    final refreshToken = await _tokenStorage.getRefreshToken();
    if (refreshToken == null) return null;

    final response = await Dio(BaseOptions(baseUrl: dio.options.baseUrl)).post(
      '/api/auth/refresh',
      data: {'refreshToken': refreshToken},
    );

    final newAccessToken = response.data['accessToken'] as String;
    final newRefreshToken = response.data['refreshToken'] as String;
    await _tokenStorage.saveTokens(accessToken: newAccessToken, refreshToken: newRefreshToken);
    return newAccessToken;
  }
}
