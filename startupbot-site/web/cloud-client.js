(function () {
  var form = document.querySelector('form[action$="/send"]');
  if (!form) return;
  var button = form.querySelector('button');
  var label = button.textContent;
  form.addEventListener('submit', function (event) {
    if (button.disabled) { event.preventDefault(); return; }
    button.disabled = true;
    button.textContent = button.getAttribute('data-pending');
  });
  window.addEventListener('pageshow', function () {
    button.disabled = false;
    button.textContent = label;
  });
  var messages = document.getElementById('conversation');
  messages.scrollTop = messages.scrollHeight;
}());

(function () {
  var fileInput = document.getElementById('file'), message = document.getElementById('message');
  if (!fileInput || !window.FileReader || !window.TextDecoder) return;
  document.getElementById('file-tools').hidden = false;
  fileInput.onchange = function () {
    var file = fileInput.files[0], status = document.getElementById('file-error');
    fileInput.value = '';
    status.textContent = '';
    if (!file) return;
    function fail() { status.textContent = status.getAttribute('data-error'); }
    if (file.size > 24000 || !/\.(txt|csv|md)$/i.test(file.name)) { fail(); return; }
    var reader = new FileReader();
    reader.onerror = fail;
    reader.onload = function () {
      try {
        var text = new TextDecoder('utf-8',{fatal:true}).decode(reader.result);
        var next = (message.value ? message.value+'\n\n' : '') + text;
        if (!text.trim() || text.indexOf('\0') !== -1 || next.length > message.maxLength) { fail(); return; }
        message.value = next;
        message.focus();
      } catch { fail(); }
    };
    reader.readAsArrayBuffer(file);
  };
}());
