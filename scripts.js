function recursionJoke() {
    old_trans = document.getElementById("upButton").style.transition;
    document.getElementById("upButton").style.transition = "none";
    document.getElementById("upButton").style.visibility = "hidden";
    alert("Recursion error: can't link back to self!");
    document.getElementById("upButton").style.transition = old_trans;
};

// When the user scrolls down 20px from the top of the document, show the button
window.onscroll = function() {scrollFunction()};

// For refresh while scrolling down
window.onload = function() {scrollFunction()};

function scrollFunction() {
    if (document.body.scrollTop > 500 || document.documentElement.scrollTop > 500) {
    document.getElementById("upButton").style.visibility = "visible";
    } else {
    document.getElementById("upButton").style.visibility = "hidden";
    }
    fade_at = 800;  // Scroll point at which background dissapears, in px
    background_opacity = Math.max((fade_at - Math.max(document.body.scrollTop, document.documentElement.scrollTop)) / fade_at, 0);
    document.getElementById("background").style.opacity = background_opacity
};

// When the user clicks on the button, scroll to the top of the document
function topFunction() {
    old_trans = document.getElementById("upButton").style.transition;
    document.getElementById("upButton").style.transition = "none";
    document.getElementById("upButton").style.visibility = "hidden";
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.getElementById("upButton").style.transition = old_trans;
};