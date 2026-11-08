<?php
  // Internal project (ZADANI.md §0): never deployed anywhere public.
  $appName = 'SUPER R-TYPE';
  $appDescription = 'Internal remake of Super R-Type (Super Nintendo, Irem 1991) — the first game on the Super Nintendo platform of svision. Not for distribution.';
  $appPrefix = 'srt';
  $appNoscript =
    '<h1>SUPER R-TYPE</h1>'.
    '<p>Internal development build of a remake of the 1991 Super Nintendo game by Irem. '.
    'R-Type is a trademark of Irem; this build exists only to develop and test the Super Nintendo platform '.
    'of the svision library.</p>'.
    '<p>Please enable JavaScript to start it.</p>';
  $appJsonLd = [
    'genre' => 'Shoot \'em up',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Super R·Type',
      'publisher' => [
        ['@type' => 'Organization', 'name' => 'Irem'],
      ],
      'datePublished' => '1991',
      'gamePlatform' => 'Super Nintendo Entertainment System',
    ],
  ];
  $devMode = true;                       // the project runs locally only (ZADANI.md §0)
  if (file_exists(__DIR__.'/config/config.php')) {
    require_once __DIR__.'/config/config.php';
  }
  require_once 'app/svision/php/main.php';
