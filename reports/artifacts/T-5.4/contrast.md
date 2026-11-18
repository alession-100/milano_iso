# T-5.4 contrast over the real rendered map

Viewports: desktop-1280x720, mobile-412x915. Modes: day, night. Views (x, z, width m): 0/0/300; 0/0/1000; 0/0/4000; -600/-600/1000; 600/600/1000; -600/600/1000; 600/-600/1000.
Each row is the worst ratio over every view, state and sampled pixel. Text needs 4.5, borders and focus rings 3.

## text: worst 4.91 (need 4.5), 0 below

| control | mode | viewport | worst ratio | view (x,z,w) | state | detail |
|---|---|---|---|---|---|---|
| #search-input (placeholder) | day | desktop-1280x720 | 4.91 | 600,600,1000 | results | placeholder rgb(84,110,122,1) on rgb(247,243,243) |
| #search-input (placeholder) | day | mobile-412x915 | 5.01 | 0,0,300 | results | placeholder rgb(84,110,122,1) on rgb(247,246,245) |
| #search-input (placeholder) | night | desktop-1280x720 | 6.75 | 0,0,1000 | results | placeholder rgb(176,190,197,1) on rgb(40,51,59) |
| #search-input (placeholder) | night | mobile-412x915 | 6.75 | 0,0,300 | results | placeholder rgb(176,190,197,1) on rgb(40,51,59) |
| #mode-toggle | night | desktop-1280x720 | 7.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(59,83,96) |
| #layers-button | night | desktop-1280x720 | 7.01 | 0,0,300 | layers | text rgb(236,239,241,1) on rgb(59,83,96) |
| #help-button | night | desktop-1280x720 | 7.01 | 0,0,300 | help | text rgb(236,239,241,1) on rgb(59,83,96) |
| #search-list li .name | night | desktop-1280x720 | 7.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(59,83,96) |
| #search-list li .kind | night | desktop-1280x720 | 7.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(59,83,96) |
| #search-list li.active .name | night | desktop-1280x720 | 7.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(59,83,96) |
| #mode-toggle | night | mobile-412x915 | 7.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(59,83,96) |
| #layers-button | night | mobile-412x915 | 7.01 | 0,0,300 | layers | text rgb(236,239,241,1) on rgb(59,83,96) |
| #help-button | night | mobile-412x915 | 7.01 | 0,0,300 | help | text rgb(236,239,241,1) on rgb(59,83,96) |
| #minimap-button | night | mobile-412x915 | 7.01 | 0,0,300 | minimap | text rgb(236,239,241,1) on rgb(59,83,96) |
| #search-list li .name | night | mobile-412x915 | 7.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(59,83,96) |
| #search-list li .kind | night | mobile-412x915 | 7.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(59,83,96) |
| #search-list li.active .name | night | mobile-412x915 | 7.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(59,83,96) |
| #attribution a | night | desktop-1280x720 | 7.27 | 0,0,300 | results | text rgb(144,202,249,1) on rgb(40,52,61) |
| #attribution a | night | mobile-412x915 | 7.35 | 0,0,300 | results | text rgb(144,202,249,1) on rgb(40,51,59) |
| #attribution a | day | desktop-1280x720 | 7.81 | 0,0,300 | results | text rgb(13,71,161,1) on rgb(244,243,242) |
| #attribution a | day | mobile-412x915 | 7.91 | 0,0,300 | results | text rgb(13,71,161,1) on rgb(246,245,243) |
| #layers-button | day | desktop-1280x720 | 10.02 | 0,0,300 | layers | text rgb(38,50,56,1) on rgb(207,227,247) |
| #help-button | day | desktop-1280x720 | 10.02 | 0,0,300 | help | text rgb(38,50,56,1) on rgb(207,227,247) |
| #search-list li .name | day | desktop-1280x720 | 10.02 | 0,0,300 | results | text rgb(38,50,56,1) on rgb(207,227,247) |
| #search-list li .kind | day | desktop-1280x720 | 10.02 | 0,0,300 | results | text rgb(38,50,56,1) on rgb(207,227,247) |
| #search-list li.active .name | day | desktop-1280x720 | 10.02 | 0,0,300 | results | text rgb(38,50,56,1) on rgb(207,227,247) |
| #layers-button | day | mobile-412x915 | 10.02 | 0,0,300 | layers | text rgb(38,50,56,1) on rgb(207,227,247) |
| #help-button | day | mobile-412x915 | 10.02 | 0,0,300 | help | text rgb(38,50,56,1) on rgb(207,227,247) |
| #minimap-button | day | mobile-412x915 | 10.02 | 0,0,300 | minimap | text rgb(38,50,56,1) on rgb(207,227,247) |
| #search-list li .name | day | mobile-412x915 | 10.02 | 0,0,300 | results | text rgb(38,50,56,1) on rgb(207,227,247) |
| #search-list li .kind | day | mobile-412x915 | 10.02 | 0,0,300 | results | text rgb(38,50,56,1) on rgb(207,227,247) |
| #search-list li.active .name | day | mobile-412x915 | 10.02 | 0,0,300 | results | text rgb(38,50,56,1) on rgb(207,227,247) |
| #help-panel li | night | desktop-1280x720 | 10.98 | 0,0,300 | help | text rgb(236,239,241,1) on rgb(42,52,56) |
| #tiles-notice span | night | mobile-412x915 | 10.98 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(42,52,56) |
| #tiles-notice button | night | mobile-412x915 | 10.98 | 0,0,300 | layers | text rgb(236,239,241,1) on rgb(42,52,56) |
| #help-panel li | night | mobile-412x915 | 10.98 | 600,600,1000 | help | text rgb(236,239,241,1) on rgb(42,52,56) |
| #attribution | night | desktop-1280x720 | 11.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(40,52,61) |
| #help-panel h2 | night | desktop-1280x720 | 11.01 | 600,600,1000 | help | text rgb(236,239,241,1) on rgb(40,52,61) |
| #attribution | night | mobile-412x915 | 11.01 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(40,52,61) |
| #lang-toggle | night | desktop-1280x720 | 11.03 | 0,0,300 | results | text rgb(236,239,241,1) on rgb(42,52,57) |

## boundary (border or fill): worst 3.47 (need 3), 0 below

| control | mode | viewport | worst ratio | view (x,z,w) | state | detail |
|---|---|---|---|---|---|---|
| #layers-button | day | desktop-1280x720 | 3.47 | 600,600,1000 | layers | border 3.38 / fill 3.47: border rgb(28,38,43), fill rgb(207,227,247), outside rgb(135,113,106) |
| #help-button | day | desktop-1280x720 | 3.51 | 0,0,1000 | help | border 3.34 / fill 3.51: border rgb(28,38,43), fill rgb(207,227,247), outside rgb(122,116,110) |
| #layers-button | day | mobile-412x915 | 3.51 | 0,0,300 | layers | border 3.34 / fill 3.51: border rgb(28,38,43), fill rgb(207,227,247), outside rgb(122,116,110) |
| #help-button | day | mobile-412x915 | 3.51 | 0,0,300 | help | border 3.34 / fill 3.51: border rgb(28,38,43), fill rgb(207,227,247), outside rgb(122,116,110) |
| #minimap-button | day | mobile-412x915 | 3.51 | 0,0,300 | minimap | border 3.34 / fill 3.51: border rgb(28,38,43), fill rgb(207,227,247), outside rgb(122,116,110) |
| #tiles-notice | day | mobile-412x915 | 3.79 | 600,600,1000 | results | border 3.79 / fill 3.75: border rgb(28,38,43), fill rgb(247,245,245), outside rgb(148,120,108) |
| #layers-panel | day | desktop-1280x720 | 3.80 | 600,-600,1000 | layers | border 3.80 / fill 3.79: border rgb(28,38,43), fill rgb(247,247,247), outside rgb(132,125,117) |
| #help-panel | day | desktop-1280x720 | 3.80 | 600,600,1000 | help | border 3.80 / fill 3.78: border rgb(28,38,43), fill rgb(247,247,246), outside rgb(132,125,117) |
| #help-panel | day | mobile-412x915 | 3.80 | 600,600,1000 | help | border 3.80 / fill 3.78: border rgb(28,38,43), fill rgb(251,246,244), outside rgb(191,101,75) |
| #search-input | day | mobile-412x915 | 3.82 | 0,0,300 | results | border 3.79 / fill 3.82: border rgb(28,38,43), fill rgb(249,248,246), outside rgb(145,122,98) |
| #search-list | day | mobile-412x915 | 3.83 | 0,0,300 | results | border 3.83 / fill 3.71: border rgb(28,38,43), fill rgb(247,245,245), outside rgb(148,121,109) |
| #layers-panel | day | mobile-412x915 | 3.83 | 0,0,300 | layers | border 3.83 / fill 3.71: border rgb(28,38,43), fill rgb(247,245,245), outside rgb(148,121,109) |
| #minimap | day | mobile-412x915 | 3.83 | 0,0,300 | minimap | border 3.83 / fill 3.71: border rgb(28,38,43), fill rgb(247,245,245), outside rgb(148,121,109) |
| #info-card | day | mobile-412x915 | 3.83 | 0,0,300 | results | border 3.80 / fill 3.83: border rgb(28,38,43), fill rgb(248,248,247), outside rgb(113,132,95) |
| #tiles-notice | day | desktop-1280x720 | 3.84 | 600,-600,1000 | layers | border 3.77 / fill 3.84: border rgb(28,38,43), fill rgb(249,247,246), outside rgb(145,120,113) |
| #info-card | day | desktop-1280x720 | 3.84 | 0,0,1000 | results | border 3.84 / fill 3.74: border rgb(28,38,43), fill rgb(247,247,246), outside rgb(132,126,117) |
| #minimap | day | desktop-1280x720 | 3.84 | 0,0,300 | results | border 3.80 / fill 3.84: border rgb(28,38,43), fill rgb(249,248,246), outside rgb(134,126,96) |
| #search-input | day | desktop-1280x720 | 3.90 | 600,600,1000 | results | border 3.68 / fill 3.90: border rgb(28,38,43), fill rgb(247,247,246), outside rgb(129,123,115) |
| #lang-toggle | day | desktop-1280x720 | 3.90 | 0,0,1000 | results | border 3.90 / fill 3.78: border rgb(28,38,43), fill rgb(250,250,249), outside rgb(134,127,118) |
| #search-list | day | desktop-1280x720 | 3.90 | 600,-600,1000 | results | border 3.90 / fill 3.71: border rgb(28,38,43), fill rgb(248,248,247), outside rgb(134,127,118) |
| #mode-toggle | day | desktop-1280x720 | 3.91 | 0,0,300 | results | border 3.65 / fill 3.91: border rgb(28,38,43), fill rgb(247,246,245), outside rgb(142,118,111) |
| #rotate-right | day | desktop-1280x720 | 3.96 | 0,0,1000 | results | border 3.96 / fill 3.65: border rgb(28,38,43), fill rgb(249,247,246), outside rgb(149,125,100) |
| #rotate-right | day | mobile-412x915 | 4.02 | 0,0,300 | results | border 4.02 / fill 3.60: border rgb(28,38,43), fill rgb(249,247,246), outside rgb(153,124,112) |
| #rotate-left | day | desktop-1280x720 | 4.18 | 0,0,1000 | results | border 4.18 / fill 3.60: border rgb(28,38,43), fill rgb(252,252,251), outside rgb(139,132,123) |
| #rotate-left | day | mobile-412x915 | 4.21 | 0,0,300 | results | border 3.38 / fill 4.21: border rgb(28,38,43), fill rgb(247,245,245), outside rgb(135,113,106) |
| #mode-toggle | day | mobile-412x915 | 4.30 | 0,0,300 | results | border 3.34 / fill 4.30: border rgb(28,38,43), fill rgb(247,247,246), outside rgb(122,116,110) |
| #lang-toggle | day | mobile-412x915 | 4.30 | 0,0,300 | results | border 3.34 / fill 4.30: border rgb(28,38,43), fill rgb(247,247,246), outside rgb(122,116,110) |
| #lang-toggle | night | desktop-1280x720 | 5.73 | 0,0,300 | results | border 5.73 / fill 2.27: border rgb(255,255,255), fill rgb(39,51,58), outside rgb(121,99,61) |
| #search-list | night | desktop-1280x720 | 5.73 | 0,0,300 | results | border 5.73 / fill 2.21: border rgb(255,255,255), fill rgb(42,52,56), outside rgb(121,99,61) |
| #help-panel | night | desktop-1280x720 | 5.73 | 0,0,300 | help | border 5.73 / fill 2.27: border rgb(255,255,255), fill rgb(40,51,55), outside rgb(121,99,61) |
| #tiles-notice | night | mobile-412x915 | 5.73 | 0,0,300 | results | border 5.73 / fill 2.21: border rgb(255,255,255), fill rgb(42,52,56), outside rgb(121,99,61) |
| #layers-panel | night | mobile-412x915 | 5.73 | 0,0,300 | layers | border 5.73 / fill 2.21: border rgb(255,255,255), fill rgb(42,52,56), outside rgb(121,99,61) |
| #minimap | night | mobile-412x915 | 5.73 | 600,600,1000 | minimap | border 5.73 / fill 2.21: border rgb(255,255,255), fill rgb(42,52,56), outside rgb(121,99,61) |
| #help-panel | night | mobile-412x915 | 6.23 | 0,0,300 | help | border 6.23 / fill 2.04: border rgb(255,255,255), fill rgb(39,52,61), outside rgb(57,96,162) |
| #search-list | night | mobile-412x915 | 6.30 | 600,600,1000 | results | border 6.30 / fill 2.11: border rgb(255,255,255), fill rgb(37,49,56), outside rgb(77,93,152) |
| #info-card | night | mobile-412x915 | 6.30 | -600,-600,1000 | results | border 6.30 / fill 2.13: border rgb(255,255,255), fill rgb(37,49,55), outside rgb(77,93,152) |
| #tiles-notice | night | desktop-1280x720 | 6.88 | 0,0,300 | results | border 6.88 / fill 1.86: border rgb(255,255,255), fill rgb(42,52,56), outside rgb(108,87,54) |
| #mode-toggle | night | desktop-1280x720 | 8.00 | -600,600,1000 | results | border 8.00 / fill 1.01: border rgb(255,255,255), fill rgb(59,83,96), outside rgb(69,78,122) |
| #rotate-left | night | desktop-1280x720 | 8.00 | -600,600,1000 | results | border 8.00 / fill 1.62: border rgb(255,255,255), fill rgb(39,51,58), outside rgb(69,78,122) |
| #rotate-right | night | desktop-1280x720 | 8.00 | -600,600,1000 | results | border 8.00 / fill 1.64: border rgb(255,255,255), fill rgb(38,50,57), outside rgb(69,78,122) |

## border alone (info): worst 1.65 (need 0), 0 below

| control | mode | viewport | worst ratio | view (x,z,w) | state | detail |
|---|---|---|---|---|---|---|
| #help-button | day | desktop-1280x720 | 1.65 | 0,0,1000 | results | border rgb(28,38,43) on rgb(72,70,75) |
| #search-list | day | desktop-1280x720 | 1.65 | 0,0,1000 | results | border rgb(28,38,43) on rgb(72,70,75) |
| #tiles-notice | day | desktop-1280x720 | 1.65 | 0,0,1000 | help | border rgb(28,38,43) on rgb(72,70,75) |
| #help-panel | day | desktop-1280x720 | 1.65 | 0,0,1000 | help | border rgb(28,38,43) on rgb(72,70,75) |
| #search-list | day | mobile-412x915 | 1.65 | 600,600,1000 | results | border rgb(28,38,43) on rgb(72,70,75) |
| #tiles-notice | day | mobile-412x915 | 1.65 | 600,600,1000 | results | border rgb(28,38,43) on rgb(72,70,75) |
| #layers-panel | day | mobile-412x915 | 1.65 | 600,600,1000 | layers | border rgb(28,38,43) on rgb(72,70,75) |
| #search-input | day | desktop-1280x720 | 1.85 | 600,600,1000 | results | border rgb(28,38,43) on rgb(119,62,47) |
| #minimap | day | desktop-1280x720 | 1.85 | 0,0,300 | results | border rgb(28,38,43) on rgb(119,62,47) |
| #layers-panel | day | desktop-1280x720 | 1.85 | 0,0,300 | layers | border rgb(28,38,43) on rgb(119,62,47) |
| #help-panel | day | mobile-412x915 | 1.85 | 0,0,300 | help | border rgb(28,38,43) on rgb(119,62,47) |
| #minimap | day | mobile-412x915 | 1.85 | 0,0,300 | minimap | border rgb(28,38,43) on rgb(119,62,47) |
| #info-card | day | mobile-412x915 | 2.19 | 0,0,300 | results | border rgb(28,38,43) on rgb(73,95,58) |
| #mode-toggle | day | desktop-1280x720 | 2.51 | 0,0,300 | results | border rgb(28,38,43) on rgb(114,93,86) |
| #rotate-left | day | desktop-1280x720 | 2.51 | 0,0,300 | results | border rgb(28,38,43) on rgb(114,93,86) |
| #info-card | day | desktop-1280x720 | 2.51 | 0,0,300 | results | border rgb(28,38,43) on rgb(114,93,86) |
| #rotate-right | day | desktop-1280x720 | 2.51 | -600,600,1000 | results | border rgb(28,38,43) on rgb(114,93,87) |
| #lang-toggle | day | desktop-1280x720 | 2.51 | 0,0,1000 | results | border rgb(28,38,43) on rgb(114,93,87) |
| #layers-button | day | desktop-1280x720 | 2.51 | 600,600,1000 | results | border rgb(28,38,43) on rgb(114,93,87) |
| #rotate-left | day | mobile-412x915 | 2.51 | 0,0,300 | results | border rgb(28,38,43) on rgb(114,93,87) |
| #lang-toggle | day | mobile-412x915 | 3.09 | 0,0,300 | results | border rgb(28,38,43) on rgb(128,108,88) |
| #minimap-button | day | mobile-412x915 | 3.09 | 0,0,300 | results | border rgb(28,38,43) on rgb(128,108,88) |
| #search-input | day | mobile-412x915 | 3.09 | 0,0,300 | results | border rgb(28,38,43) on rgb(128,108,88) |
| #mode-toggle | day | mobile-412x915 | 3.34 | 0,0,300 | results | border rgb(28,38,43) on rgb(122,116,110) |
| #rotate-right | day | mobile-412x915 | 3.34 | 0,0,300 | results | border rgb(28,38,43) on rgb(122,116,110) |
| #layers-button | day | mobile-412x915 | 3.34 | 0,0,300 | results | border rgb(28,38,43) on rgb(122,116,110) |
| #help-button | day | mobile-412x915 | 3.34 | 0,0,300 | results | border rgb(28,38,43) on rgb(122,116,110) |
| #lang-toggle | night | desktop-1280x720 | 5.73 | 0,0,300 | results | border rgb(255,255,255) on rgb(121,99,61) |
| #search-list | night | desktop-1280x720 | 5.73 | 0,0,300 | results | border rgb(255,255,255) on rgb(121,99,61) |
| #help-panel | night | desktop-1280x720 | 5.73 | 0,0,300 | help | border rgb(255,255,255) on rgb(121,99,61) |
| #tiles-notice | night | mobile-412x915 | 5.73 | 0,0,300 | results | border rgb(255,255,255) on rgb(121,99,61) |
| #layers-panel | night | mobile-412x915 | 5.73 | 0,0,300 | layers | border rgb(255,255,255) on rgb(121,99,61) |
| #minimap | night | mobile-412x915 | 5.73 | 600,600,1000 | minimap | border rgb(255,255,255) on rgb(121,99,61) |
| #help-panel | night | mobile-412x915 | 6.23 | 0,0,300 | help | border rgb(255,255,255) on rgb(57,96,162) |
| #search-list | night | mobile-412x915 | 6.30 | 600,600,1000 | results | border rgb(255,255,255) on rgb(77,93,152) |
| #info-card | night | mobile-412x915 | 6.30 | -600,-600,1000 | results | border rgb(255,255,255) on rgb(77,93,152) |
| #tiles-notice | night | desktop-1280x720 | 6.88 | 0,0,300 | results | border rgb(255,255,255) on rgb(108,87,54) |
| #mode-toggle | night | desktop-1280x720 | 8.00 | -600,600,1000 | results | border rgb(255,255,255) on rgb(69,78,122) |
| #rotate-left | night | desktop-1280x720 | 8.00 | -600,600,1000 | results | border rgb(255,255,255) on rgb(69,78,122) |
| #rotate-right | night | desktop-1280x720 | 8.00 | -600,600,1000 | results | border rgb(255,255,255) on rgb(69,78,122) |

## focus ring vs halo: worst 9.33 (need 3), 0 below

| control | mode | viewport | worst ratio | view (x,z,w) | state | detail |
|---|---|---|---|---|---|---|
| #mode-toggle | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #rotate-left | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #rotate-right | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #lang-toggle | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #layers-button | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #help-button | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #search-input | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #tiles-notice button | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #info-card .close | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #attribution a | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #app | night | desktop-1280x720 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #mode-toggle | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #rotate-left | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #rotate-right | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #lang-toggle | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #layers-button | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #help-button | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #minimap-button | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #search-input | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #tiles-notice button | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #info-card .close | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #attribution a | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #app | night | mobile-412x915 | 9.33 | 0,0,300 | results | ring rgb(255,213,79) halo rgb(38,50,56) |
| #mode-toggle | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #rotate-left | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #rotate-right | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #lang-toggle | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #layers-button | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #help-button | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #search-input | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #tiles-notice button | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #info-card .close | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #attribution a | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #app | day | desktop-1280x720 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #mode-toggle | day | mobile-412x915 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #rotate-left | day | mobile-412x915 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #rotate-right | day | mobile-412x915 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #lang-toggle | day | mobile-412x915 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #layers-button | day | mobile-412x915 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |
| #help-button | day | mobile-412x915 | 12.76 | 0,0,300 | results | ring rgb(8,48,107) halo rgb(255,255,255) |

## focus indicator vs map (ring or halo): worst 3.58 (need 3), 0 below

| control | mode | viewport | worst ratio | view (x,z,w) | state | detail |
|---|---|---|---|---|---|---|
| #tiles-notice button | day | mobile-412x915 | 3.58 | 0,0,300 | help | ring 3.58 / halo 3.56 on map rgb(126,138,139) |
| #app | day | desktop-1280x720 | 3.58 | -600,600,1000 | results | ring 3.56 / halo 3.58 on map rgb(156,131,104) |
| #layers-button | day | desktop-1280x720 | 3.58 | 600,600,1000 | results | ring 3.58 / halo 3.56 on map rgb(157,130,120) |
| #tiles-notice button | day | desktop-1280x720 | 3.58 | 0,0,1000 | layers | ring 3.58 / halo 3.56 on map rgb(157,130,120) |
| #app | day | mobile-412x915 | 3.58 | -600,-600,1000 | results | ring 3.58 / halo 3.56 on map rgb(157,130,120) |
| #attribution a | day | mobile-412x915 | 3.59 | 0,0,300 | results | ring 3.59 / halo 3.56 on map rgb(114,145,86) |
| #lang-toggle | day | mobile-412x915 | 3.60 | 0,0,300 | results | ring 3.55 / halo 3.60 on map rgb(141,134,124) |
| #rotate-left | day | mobile-412x915 | 3.61 | 0,0,300 | results | ring 3.54 / halo 3.61 on map rgb(153,131,109) |
| #minimap-button | day | mobile-412x915 | 3.61 | 0,0,300 | results | ring 3.61 / halo 3.54 on map rgb(157,132,105) |
| #info-card .close | day | mobile-412x915 | 3.62 | 0,0,300 | results | ring 3.53 / halo 3.62 on map rgb(152,131,109) |
| #search-input | day | mobile-412x915 | 3.63 | 0,0,300 | results | ring 3.51 / halo 3.63 on map rgb(141,133,124) |
| #rotate-left | day | desktop-1280x720 | 3.64 | 0,0,1000 | results | ring 3.64 / halo 3.51 on map rgb(143,136,126) |
| #search-input | day | desktop-1280x720 | 3.64 | 600,600,1000 | results | ring 3.64 / halo 3.51 on map rgb(143,136,126) |
| #lang-toggle | day | desktop-1280x720 | 3.65 | 0,0,300 | results | ring 3.49 / halo 3.65 on map rgb(141,133,118) |
| #help-button | day | desktop-1280x720 | 3.65 | 600,600,1000 | results | ring 3.49 / halo 3.65 on map rgb(141,133,118) |
| #attribution a | day | desktop-1280x720 | 3.65 | 0,0,1000 | results | ring 3.49 / halo 3.65 on map rgb(141,133,118) |
| #info-card .close | day | desktop-1280x720 | 3.68 | 0,0,1000 | results | ring 3.47 / halo 3.68 on map rgb(154,129,103) |
| #rotate-right | day | desktop-1280x720 | 3.69 | 0,0,1000 | results | ring 3.45 / halo 3.69 on map rgb(139,132,123) |
| #rotate-right | day | mobile-412x915 | 3.74 | 0,0,300 | results | ring 3.74 / halo 3.41 on map rgb(209,112,85) |
| #mode-toggle | day | mobile-412x915 | 3.82 | 0,0,300 | results | ring 3.82 / halo 3.34 on map rgb(144,140,134) |
| #layers-button | day | mobile-412x915 | 3.82 | 0,0,300 | results | ring 3.82 / halo 3.34 on map rgb(144,140,134) |
| #help-button | day | mobile-412x915 | 3.82 | 0,0,300 | results | ring 3.82 / halo 3.34 on map rgb(144,140,134) |
| #tiles-notice button | night | desktop-1280x720 | 4.06 | 0,0,300 | help | ring 4.06 / halo 2.30 on map rgb(121,99,61) |
| #tiles-notice button | night | mobile-412x915 | 4.06 | 0,0,300 | layers | ring 4.06 / halo 2.30 on map rgb(121,99,61) |
| #lang-toggle | night | desktop-1280x720 | 4.10 | 0,0,300 | results | ring 4.10 / halo 2.27 on map rgb(121,98,61) |
| #mode-toggle | day | desktop-1280x720 | 4.16 | -600,600,1000 | results | ring 4.16 / halo 3.06 on map rgb(158,147,110) |
| #help-button | night | desktop-1280x720 | 4.18 | 0,0,300 | results | ring 4.18 / halo 2.23 on map rgb(117,97,71) |
| #attribution a | night | desktop-1280x720 | 5.07 | -600,-600,1000 | results | ring 5.07 / halo 1.84 on map rgb(52,87,148) |
| #app | night | desktop-1280x720 | 5.07 | -600,-600,1000 | results | ring 5.07 / halo 1.84 on map rgb(52,87,148) |
| #mode-toggle | night | desktop-1280x720 | 5.67 | -600,600,1000 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #rotate-left | night | desktop-1280x720 | 5.67 | -600,600,1000 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #rotate-right | night | desktop-1280x720 | 5.67 | -600,600,1000 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #layers-button | night | desktop-1280x720 | 5.67 | 0,0,1000 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #search-input | night | desktop-1280x720 | 5.67 | 0,0,1000 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #info-card .close | night | desktop-1280x720 | 5.67 | -600,600,1000 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #search-input | night | mobile-412x915 | 5.67 | 0,0,300 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #info-card .close | night | mobile-412x915 | 5.67 | 0,0,300 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #attribution a | night | mobile-412x915 | 5.67 | 0,0,300 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #app | night | mobile-412x915 | 5.67 | 0,0,300 | results | ring 5.67 / halo 1.64 on map rgb(69,78,122) |
| #mode-toggle | night | mobile-412x915 | 5.69 | 0,0,300 | results | ring 5.69 / halo 1.64 on map rgb(65,78,126) |

