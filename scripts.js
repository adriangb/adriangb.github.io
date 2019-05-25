function recursionJoke() {
    alert("Recursion error: can't link back to self!");
    document.getElementsByTagName("nav")[0].scrollIntoView();
};

// LINKS TO ANCHORS
$('a[href^="#"]').on('click', function(event) {

    var $target = $(this.getAttribute('href'));
    if($target.length) {
      event.preventDefault();
      $('html, body').stop().animate({
        scrollTop: $target.offset().top
      }, 750, 'easeInOutQuad');
    }
  });

// Hide Header on on scroll down
var didScroll;
var lastScrollTop = 0;
var delta = 5;
var navbarHeight = $('header').outerHeight();

$(window).scroll(function(event){
    didScroll = true;
});

setInterval(function() {
    if (didScroll) {
        hasScrolled();
        didScroll = false;
    }
  }, 250);

function hasScrolled() {
    var st = Math.max(document.body.scrollTop,  document.documentElement.scrollTop);
    // Check that scroll is more than delta
    if(Math.abs(lastScrollTop - st) <= delta)
        return;
    // If so, hide navbar
    if (st > lastScrollTop && st > navbarHeight){
        // Scroll Down
        $('header').removeClass('show-nav').addClass('hide-nav');
    } else {
        // Scroll Up
        if(st + $(window).height() < $(document).height()) {
            $('header').removeClass('hide-nav').addClass('show-nav');
        }
    }
    lastScrollTop = st;
};