var grab=startX=startY=oldTop=oldLeft=0;
document.addEventListener('click',function(e){e.preventDefault()},true);
document.addEventListener('mousedown',pick);
document.addEventListener('touchstart',pick);
function pick(e){
	e.preventDefault();
	if (e.target!==document.documentElement && e.target!==document.body){
		grab=Date.now();
		e.target.setAttribute('data-drag',grab);
		e.target.style.position='relative';
		oldTop=e.target.style.top.split('px')[0]||0;
		oldLeft=e.target.style.left.split('px')[0]||0;
	}
	startX=e.clientX||e.touches[0].clientX;
	startY=e.clientY||e.touches[0].clientY;
}
document.addEventListener('mousemove',drag);
document.addEventListener('touchmove',drag);
function drag(e){
	if (grab!==''){
		var element=document.querySelector('[data-drag="'+grab+'"]');
		element.style.top=parseInt(oldTop)+parseInt((e.clientY||e.touches[0].clientY)-startY)+'px';
		element.style.left=parseInt(oldLeft)+parseInt((e.clientX||e.touches[0].clientX)-startX)+'px';
	}
}
document.addEventListener('mouseup',release);
document.addEventListener('touchend',release);
function release(e){
	grab='';
}
document.addEventListener('mouseover',over);
function over(e){
	e.target.style.cursor='move'
	e.target.style.boxShadow='inset lime 0 0 1px, lime 0 0 1px'
}
document.addEventListener('mouseout',out);
function out(e){
	e.target.style.cursor=e.target.style.boxShadow=''
}