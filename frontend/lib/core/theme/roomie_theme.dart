import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Design tokens mirror the admin dashboard's Tailwind palette
/// (admin-dashboard/tailwind.config.js) so the whole product feels like
/// one system, not two separately-designed surfaces.
class RoomieColors {
  RoomieColors._();

  static const surface = Color(0xFF0F1115);
  static const surfaceRaised = Color(0xFF161922);
  static const surfaceOverlay = Color(0xFF1E222D);
  static const surfaceBorder = Color(0xFF2A2F3D);

  static const accent = Color(0xFF7C5CFF);
  static const accentHover = Color(0xFF8F72FF);
  static const accentMuted = Color(0xFF2F2A4F);

  static const success = Color(0xFF3ECF8E);
  static const warning = Color(0xFFF5A524);
  static const danger = Color(0xFFF5455C);

  static const textPrimary = Color(0xFFECEEF2);
  static const textSecondary = Color(0xFF9AA1B0);
}

class RoomieTheme {
  RoomieTheme._();

  static ThemeData get dark {
    final base = ThemeData.dark(useMaterial3: true);
    final textTheme = GoogleFonts.interTextTheme(base.textTheme).apply(
      bodyColor: RoomieColors.textPrimary,
      displayColor: RoomieColors.textPrimary,
    );

    return base.copyWith(
      scaffoldBackgroundColor: RoomieColors.surface,
      textTheme: textTheme,
      colorScheme: base.colorScheme.copyWith(
        primary: RoomieColors.accent,
        secondary: RoomieColors.accent,
        surface: RoomieColors.surfaceRaised,
        error: RoomieColors.danger,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: RoomieColors.surface,
        elevation: 0,
        centerTitle: false,
        foregroundColor: RoomieColors.textPrimary,
      ),
      cardTheme: CardTheme(
        color: RoomieColors.surfaceRaised,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: RoomieColors.surfaceBorder),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: RoomieColors.accent,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: RoomieColors.textPrimary,
          side: const BorderSide(color: RoomieColors.surfaceBorder),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: RoomieColors.surfaceOverlay,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: RoomieColors.surfaceBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: RoomieColors.surfaceBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: RoomieColors.accent, width: 1.5),
        ),
        hintStyle: const TextStyle(color: RoomieColors.textSecondary),
      ),
      dividerTheme: const DividerThemeData(color: RoomieColors.surfaceBorder, thickness: 1),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: RoomieColors.surfaceRaised,
        selectedItemColor: RoomieColors.accent,
        unselectedItemColor: RoomieColors.textSecondary,
        type: BottomNavigationBarType.fixed,
      ),
    );
  }
}
