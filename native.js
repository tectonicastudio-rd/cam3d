/* CAM3D · puente con la app nativa de Android (solo actúa dentro del APK) */
(function () {
  var N = window.CAM3DNative; if (!N) return;
  window.CAM3D_NATIVE = true;
  // dictado por voz con el reconocedor de Android
  var cur = null;
  function SR() { this.lang = 'es-ES'; this.interimResults = true; this.continuous = false; this.maxAlternatives = 1; }
  SR.prototype.start = function () { cur = this; N.listen(this.lang || 'es-ES', !!this.interimResults); };
  SR.prototype.stop = function () { N.stopListen(); };
  SR.prototype.abort = function () { N.stopListen(); };
  window.SpeechRecognition = window.webkitSpeechRecognition = SR;
  window.CAM3DSpeech = function (type, text, fin) {
    var r = cur; if (!r) return;
    if (type === 'start') { r.onstart && r.onstart(); }
    else if (type === 'result') { var res = [[{ transcript: text, confidence: 1 }]]; res[0].isFinal = !!fin; r.onresult && r.onresult({ resultIndex: 0, results: res }); }
    else if (type === 'error') { r.onerror && r.onerror({ error: text }); }
    else if (type === 'end') { cur = null; r.onend && r.onend(); }
  };
  // voz (texto a voz) de Android
  function U(t) { this.text = t || ''; this.lang = 'es-ES'; this.rate = 1; this.pitch = 1; this.voice = null; }
  var ss = { speaking: false, pending: false, paused: false,
    speak: function (u) { try { N.speak(String(u && u.text || ''), +(u && u.rate) || 1); } catch (e) { } },
    cancel: function () { try { N.stopSpeak(); } catch (e) { } },
    getVoices: function () { return [{ lang: 'es-ES', name: 'Android', default: true, localService: true }]; },
    pause: function () { }, resume: function () { }, addEventListener: function () { } };
  window.SpeechSynthesisUtterance = U;
  try { Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: function () { return ss; } }); } catch (e) { window.speechSynthesis = ss; }
})();
