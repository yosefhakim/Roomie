import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router/app_router.dart';
import 'core/theme/roomie_theme.dart';

void main() {
  runApp(const ProviderScope(child: RoomieApp()));
}

class RoomieApp extends ConsumerWidget {
  const RoomieApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Roomie',
      debugShowCheckedModeBanner: false,
      theme: RoomieTheme.dark,
      darkTheme: RoomieTheme.dark,
      themeMode: ThemeMode.dark,
      routerConfig: router,
    );
  }
}
