const wrapper = document.createElement("div");

// let dNone = "display: none"

// wrapper.style
wrapper.innerHTML = `   
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/5.0.0/normalize.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
<link rel="stylesheet" href="https://mrakcw.github.io/cdn/css/getintouch.css">
<div class="contact-wrapper" id="mrakcw" style="display: none">
    <div class="contact-panel">
        <div class="contact-panel__header">
          <a href="https://nick-name.ru/nickname/mrakcw/" target="_blank" style="color: #eee; font-family: 'Pacifico', cursive;font-size: 21px;">MrakCw Design</a>
        </div>
        <button class="contact-close"><i class="fa fa-times"></i></button>
        <ul>
          <li><a rel="nofollow" href="https://t.me/mrakcw" target="_blank" title="Telegram"><i class="fa fa-telegram"></i></a></li>
          <li><a rel="nofollow" href="https://vk.com/mrakcw" target="_blank" title="VK"><i class="fa fa-vk"></i></a></li>
          <li><a rel="nofollow" href="https://fb.com/mrakcw" target="_blank" title="Facebook"><i class="fa fa-facebook"></i></a></li>
          <li><a rel="nofollow" href="https://www.linkedin.com/in/mrakcw" target="_blank" title="LinkedIn"><i class="fa fa-linkedin"></i></a></li>
          <li><a rel="nofollow" href="https://github.com/mrakcw" target="_blank" title="GitHub"><i class="fa fa-github"></i></a></li>
          <li><a rel="nofollow" href="https://steamcommunity.com/id/mrakcw/" target="_blank" title="Steam"><i class="fa fa-steam"></i></a></li>
        </ul>
    </div>
</div>
<button class="contact-button" style="font-family: 'Pacifico', cursive;">MrakCw Design</button>`;

document.body.appendChild(wrapper);
const contactButton = document.querySelector(".contact-button");
const contactClose = document.querySelector(".contact-close");
const contactWrapper = document.querySelector(".contact-wrapper");

contactButton.addEventListener("click", () => {
  contactWrapper.classList.toggle("contact-wrapper--open");
});

contactClose.addEventListener("click", () => {
  contactWrapper.classList.remove("contact-wrapper--open");
});
