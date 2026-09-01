import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/wallet.dart';
import 'core_providers.dart';

class WalletController extends StateNotifier<Wallet?> {
  WalletController(this._ref) : super(null);

  final Ref _ref;

  Future<void> refresh() async {
    final response = await _ref.read(apiClientProvider).dio.get('/api/economy/wallet');
    state = Wallet.fromJson(Map<String, dynamic>.from(response.data['wallet'] as Map));
  }

  Future<void> sendGift({required String receiverId, required String giftSlug, String? roomId}) async {
    await _ref.read(apiClientProvider).dio.post('/api/economy/gifts/send', data: {
      'receiverId': receiverId,
      'giftSlug': giftSlug,
      if (roomId != null) 'roomId': roomId,
    });
    // Re-fetch balance rather than optimistically decrementing locally -
    // the server is the only source of truth for balance math (see
    // economyService.js's ledger-based design on the backend), so we defer
    // to it rather than risk the UI showing a value that could drift from
    // reality under a rejected/failed request.
    await refresh();
  }

  Future<Map<String, dynamic>> claimDailyReward() async {
    final response = await _ref.read(apiClientProvider).dio.post('/api/economy/daily-reward/claim');
    await refresh();
    return Map<String, dynamic>.from(response.data as Map);
  }
}

final walletControllerProvider = StateNotifierProvider<WalletController, Wallet?>((ref) => WalletController(ref));
