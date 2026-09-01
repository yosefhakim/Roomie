import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/state/core_providers.dart';
import '../core/state/wallet_provider.dart';
import '../core/theme/roomie_theme.dart';
import '../models/wallet.dart';

class GiftPickerSheet extends ConsumerStatefulWidget {
  const GiftPickerSheet({super.key, required this.roomId, required this.receiverId, required this.receiverName});

  final String roomId;
  final String receiverId;
  final String receiverName;

  @override
  ConsumerState<GiftPickerSheet> createState() => _GiftPickerSheetState();
}

class _GiftPickerSheetState extends ConsumerState<GiftPickerSheet> {
  List<GiftCatalogItem> _catalog = [];
  bool _loading = true;
  String? _sendingSlug;

  @override
  void initState() {
    super.initState();
    _fetchCatalog();
  }

  Future<void> _fetchCatalog() async {
    // GET /api/economy/gifts/catalog - see backend/src/routes/economy.js.
    final response = await ref.read(apiClientProvider).dio.get('/api/economy/gifts/catalog');
    final items = (response.data['catalog'] as List<dynamic>).cast<Map<String, dynamic>>();
    if (mounted) {
      setState(() {
        _catalog = items.map(GiftCatalogItem.fromJson).toList();
        _loading = false;
      });
    }
  }

  Future<void> _sendGift(GiftCatalogItem gift) async {
    setState(() => _sendingSlug = gift.slug);
    try {
      await ref.read(walletControllerProvider.notifier).sendGift(
            receiverId: widget.receiverId,
            giftSlug: gift.slug,
            roomId: widget.roomId,
          );
      // The actual animation trigger is the 'gift:received' socket event
      // broadcast by the server (see backend/src/routes/economy.js) and
      // consumed room-wide via GameController.gameEvents in
      // room_screen.dart's listener - NOT fired directly from here. This
      // way every member in the room sees the gift animation
      // simultaneously, not just the sender.
      if (mounted) Navigator.of(context).pop();
    } catch (err) {
      if (mounted) {
        final message =
            err.toString().contains('INSUFFICIENT_BALANCE') ? 'Not enough coins for this gift' : 'Failed to send gift';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      }
    } finally {
      if (mounted) setState(() => _sendingSlug = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(walletControllerProvider);

    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(context).viewInsets.bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Send a gift to ${widget.receiverName}', style: Theme.of(context).textTheme.titleMedium),
              ),
              const Icon(Icons.monetization_on, size: 16, color: RoomieColors.warning),
              const SizedBox(width: 4),
              Text('${wallet?.coins ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 20),
          if (_loading)
            const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
          else
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 0.85,
              ),
              itemCount: _catalog.length,
              itemBuilder: (context, index) {
                final gift = _catalog[index];
                final affordable = (wallet?.coins ?? 0) >= gift.priceCoins;
                final sending = _sendingSlug == gift.slug;

                return InkWell(
                  onTap: affordable && _sendingSlug == null ? () => _sendGift(gift) : null,
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    decoration: BoxDecoration(
                      color: RoomieColors.surfaceOverlay,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: RoomieColors.surfaceBorder),
                    ),
                    child: Opacity(
                      opacity: affordable ? 1.0 : 0.4,
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          if (sending)
                            const CircularProgressIndicator(strokeWidth: 2)
                          else
                            const Icon(Icons.card_giftcard, size: 28, color: RoomieColors.accent),
                          const SizedBox(height: 6),
                          Text(gift.displayName, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text('${gift.priceCoins}', style: const TextStyle(fontSize: 11, color: RoomieColors.textSecondary)),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}
