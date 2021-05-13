const inTop = document.createElement("div");

inTop.innerHTML = `
		<style>
			.in_top{position:fixed;right:40px;bottom:35px;width:30px;height:30px;opacity:0;filter:alpha(opacity=50);cursor:pointer;display:none; padding:.5em;z-index:5;}
			.in_top{opacity:1;filter:alpha(opacity=100);}
			.in_top span{display:block;font-size:2rem;}
			@media (max-width:575px){.in_top{width:30px;height:30px;bottom:35px;right:40px;top:unset;opacity:1;z-index:5}.in_top span{margin-top:0;font-size:2rem}}
		</style>
		<div class="in_top">
			<span>⏫</span>
		</div>
		`;
document.body.appendChild(inTop);

var bottom_position = 0;
var flag_bottom = false;
var flag_animate = false;

$(document).ready(function () {
  $(".in_top").click(function () {
    flag_animate = true;
    if (flag_bottom) {
      $("body,html").animate({ scrollTop: bottom_position }, 700, function () {
        flag_animate = false;
      });
      flag_bottom = false;
      $(".in_top span").html("⏫");
    } else {
      $("body,html").animate({ scrollTop: 0 }, 700, function () {
        flag_animate = false;
      });
      bottom_position = $(window).scrollTop();
      flag_bottom = false;
      $(".in_top span").html("⏫");
    }
  });

  $(window).scroll(function (event) {
    var countScroll = $(window).scrollTop();
    if (countScroll > 300 && !flag_animate) {
      $(".in_top").show();
      if (!flag_bottom) {
        flag_bottom = false;
        $(".in_top span").html("⏫");
      }
    } else {
      if (!flag_bottom) {
        $(".in_top").hide();
      }
    }
  });
});
