import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../network/api_client.dart';
import '../network/socket_manager.dart';
import '../network/token_storage.dart';

final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(tokenStorage: ref.watch(tokenStorageProvider));
});

final socketManagerProvider = Provider<SocketManager>((ref) {
  final manager = SocketManager(
    baseUrl: const String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:4000'),
    tokenStorage: ref.watch(tokenStorageProvider),
  );
  ref.onDispose(manager.dispose);
  return manager;
});
