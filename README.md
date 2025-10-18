EspruinoAppLoaderCore
=====================

[![Build Status](https://github.com/espruino/EspruinoAppLoaderCore/actions/workflows/nodejs.yml/badge.svg)](https://github.com/espruino/EspruinoAppLoaderCore/actions/workflows/nodejs.yml)

This is the code used for both:

* [Bangle.js](https://banglejs.com/) App Loader : https://github.com/espruino/BangleApps
* [Espruino](http://www.espruino.com/) App Loader : https://github.com/espruino/EspruinoApps

It forms a simple free "App Store" website that can be used to load applications
onto embedded devices.

See https://github.com/espruino/BangleApps for more details on usage and the
format of `apps.json`.

## Testing
To test different changes:
1. Clone the `BangleApps` repository on your local machine.
2. Make changes to this submodule inside the BangleApps folder `core`. In GitHub web, it's shown as a link to the submodule, but in a clone on your PC, it has all the files that this module has.
3. Test using `index.html`, and when you are ready, migrate changes to here
4. Create a PR to merge your changes with the upstream repository
