class Wallet {
  const Wallet({required this.coins, required this.diamonds});
  final int coins;
  final int diamonds;

  factory Wallet.fromJson(Map<String, dynamic> json) => Wallet(
        coins: int.parse(json['coins'].toString()),
        diamonds: int.parse(json['diamonds'].toString()),
      );
}

/// Mirrors migrations/004_economy_system.sql's gift_catalog table as
/// returned by GET /api/economy/gifts/catalog.
class GiftCatalogItem {
  const GiftCatalogItem({
    required this.id,
    required this.slug,
    required this.displayName,
    required this.priceCoins,
    required this.animationKey,
  });

  final String id;
  final String slug;
  final String displayName;
  final int priceCoins;
  final String animationKey; // looked up against assets/animations/*.json (Lottie files)

  factory GiftCatalogItem.fromJson(Map<String, dynamic> json) => GiftCatalogItem(
        id: json['id'] as String,
        slug: json['slug'] as String,
        displayName: json['display_name'] as String,
        priceCoins: int.parse(json['price_coins'].toString()),
        animationKey: json['animation_key'] as String,
      );
}

/// Matches the payload shape of the 'gift:received' socket event emitted by
/// backend/src/routes/economy.js's POST /gifts/send handler.
class GiftReceivedEvent {
  const GiftReceivedEvent({
    required this.giftSlug,
    required this.animationKey,
    required this.senderId,
    required this.senderDisplayName,
    required this.receiverId,
  });

  final String giftSlug;
  final String animationKey;
  final String senderId;
  final String senderDisplayName;
  final String receiverId;

  factory GiftReceivedEvent.fromJson(Map<String, dynamic> json) => GiftReceivedEvent(
        giftSlug: json['giftSlug'] as String,
        animationKey: json['animationKey'] as String,
        senderId: json['senderId'] as String,
        senderDisplayName: json['senderDisplayName'] as String,
        receiverId: json['receiverId'] as String,
      );
}
