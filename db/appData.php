<?php

class DataCommand {

  // What the application gets at start (M1):
  //
  // - `screen`        – one frame of level 1 as the running original made it
  //                     (VRAM, CGRAM, OAM, registers, brightness writes), tools/mkscreen.py
  // - `screen_title`  – the title screen the same way (the menu sits on it)
  //
  // From M2 the data of the cartridge (tools/dump*.py) take the place of the
  // frame. A missing file arrives as null and the application survives it.
  //
  // Internal project (ZADANI.md §0): no public hall of fame and no database —
  // the hall of fame is local (localStorage), hiScore here is 0.
  // M2: `levels`, `tiles`, `palettes` — the cartridge's data (tools/dump*.py)
  // M3: `ship` (bank $04 and the object scripts of bank $06), `sprites`
  //      (the metasprites), `waves` (the spawn lists) — what the worker's
  //      game code reads (app/gameKernel.js, ship.js)
  var $files = ['screen', 'screen_title', 'levels', 'tiles', 'palettes', 'ship', 'sprites', 'waves'];

  public function execute($postData) {
    $result = [];
    foreach ($this->files as $file) {
      $fileName = 'data/'.$file.'.json';
      if (!is_file($fileName)) {
        $result[$file] = null;
        continue;
      }
      $dataJSON = file_get_contents($fileName);
      try {
        $result[$file] = json_decode($dataJSON, false, 512, JSON_THROW_ON_ERROR);
      }
      catch (\JsonException $exception) {
        $result[$file] = ['error' => ['message' => $exception->getMessage()]];
      }
    }
    $result['hiScore'] = 0;
    return $result;
  } // execute

} // class DataCommand
