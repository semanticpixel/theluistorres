// For any third party dependencies, like jQuery, place them in the lib folder.

// Configure loading modules from the lib directory,
// except for 'app' ones, which are in a sibling
// directory.
requirejs.config({
    baseUrl: 'src/javascript',
    paths: {
        app: '../dist'
    }
});

// Start loading the main app file. Put all of
// your application logic in there.
requirejs(['main'], function(main) {
    main.loadImages();
});
define('image', [
    'util'
], function(
    Utils
) {
    'use strict';

    var Image = {
        loadProgressiveImages_v3: function(imageElems) {
            var length = imageElems.length;

            for (var i = 0; i < length; i++) {
                Utils.addEvent(imageElems[i], 'load', function handler() {
                    if (this.dataset.loaded === 'small') {
                        this.className += ' loaded';
                        this.dataset.loaded = 'medium';

                        this.src = this.dataset.large;
                    } else if (this.dataset.loaded === 'medium') {
                        this.dataset.loaded = 'large';
                        Utils.removeEvent(this, 'load', handler);
                    }
                });

                imageElems[i].src = imageElems[i].dataset.medium;
            }
        }
    };

    return Image;
});
define('main', [
    'image'
], function(
    Image
) {
    'use strict';

    return {
        loadImages: function() {
            var imageElems = document.querySelectorAll('.js-img-preload');
            Image.loadProgressiveImages_v3(imageElems);
        }
    };
});
define('util', [
], function(
) {
    'use strict';

    var Util = {
        addEvent: function(elem, event, func) {
            if (elem.addEventListener) {
                elem.addEventListener(event, func, false);
            } else if (elem.attachEvent) {
                elem.attachEvent('on' + event, func);
            }
        },
        addEvents: function(elem, events, func) {
            var eventsArray = events.split(' ');
            var length = eventsArray.length;
            var hasEventListener = elem.addEventListener ? true : false;

            for (var i = 0; i < length; i++) {
                console.log(hasEventListener);
                if (hasEventListener) {
                    elem.addEventListener(eventsArray[i], func, false);
                } else {
                    elem.attachEvent('on' + eventsArray[i], func);
                }
            }
        },
        removeEvent: function(elem, event, func) {
            if (elem.removeEventListener) {
                elem.removeEventListener(event, func, false);
            } else if (elem.detachEvent) {
                elem.detachEvent('on' + event, func);
            }
        },
        removeEvents: function(elem, events, func) {
            var eventsArray = events.split(" ");
            var length = eventsArray.length;
            var hasEventListener = elem.removeEventListener ? true : false;

            for (var i = 0; i < length; i++) {
                if (hasEventListener) {
                    elem.removeEventListener(eventsArray[i], func, false);
                } else {
                    elem.detachEvent('on' + eventsArray[i], func);
                }
            }
        }
    };

    return Util;
});