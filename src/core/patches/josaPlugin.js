/*:
 * @target MV MZ
 * @plugindesc 한국어 조사 자동 맞춤: 이름·숫자가 들어간 뒤 은(는) 같은 조사를 고릅니다.
 * @author MVMZ 번역 작업실
 *
 * @help
 * 번역문에 "%1은(는)", "\N[1]이(가)" 처럼 적힌 조사를, 게임이 이름이나 숫자를
 * 끼워 넣은 뒤 앞 글자의 받침에 맞춰 하나로 고릅니다.
 *
 * 맞추는 꼴: 은(는) 이(가) 을(를) 과(와) 아(야) (와 양쪽 순서),
 * (으)로 (이)라 (이)나 (이)랑 (이)야 (이)여 (이)고 (이)다 (이)든 (이)면
 *
 * 앞 글자가 한글·숫자·영문이 아니면 그대로 둡니다.
 * 플러그인 목록의 맨 아래에 두세요. 설정할 것은 없습니다.
 */
// Kept to ES5: MV games run on old NW.js builds. Every wrapper calls the function it replaced and only edits
// the text it returned, so other plugins that changed the same functions keep working.
(function () {
  'use strict';

  var HANGUL_FIRST = 0xac00;
  var HANGUL_LAST = 0xd7a3;
  var RIEUL = 8;
  var FORMS = /은\(는\)|는\(은\)|이\(가\)|가\(이\)|을\(를\)|를\(을\)|과\(와\)|와\(과\)|아\(야\)|야\(아\)|\(으\)로|\(이\)(?:라|나|랑|야|여|고|다|든|면)/g;
  // [after a final consonant, after a vowel]
  var PAIRS = {
    '은(는)': ['은', '는'], '는(은)': ['은', '는'],
    '이(가)': ['이', '가'], '가(이)': ['이', '가'],
    '을(를)': ['을', '를'], '를(을)': ['을', '를'],
    '과(와)': ['과', '와'], '와(과)': ['과', '와'],
    '아(야)': ['아', '야'], '야(아)': ['아', '야'],
    '(으)로': ['으로', '로']
  };
  // How each digit is read: 0 영, 1 일, 2 이, 3 삼, 4 사, 5 오, 6 육, 7 칠, 8 팔, 9 구 (10, 100... end in 0 and read 십, 백: also final).
  // 0 = no final, 1 = final, 2 = final ㄹ.
  var DIGIT_FINAL = [1, 2, 0, 1, 0, 0, 1, 2, 2, 0];
  var CLOSERS = '」』）)"\'”’】]';
  // A control code that ends right before a position: ESC (after the game converted it) or a raw backslash.
  var CODE_BEFORE = /(\x1b|\\)([A-Za-z]+(?:\[[^\]\x1b\\]*\])?|[{}.|!<>\^$])$/;
  // Raw codes the game still has to replace with a name or a number: the letter before them is not the one read.
  var TEXT_CODE = /^[NVPG]/i;

  // 0 / 1 / 2 as in DIGIT_FINAL, or -1 when the final sound cannot be told.
  function finalOf(text, end) {
    var i = end;
    while (i > 0) {
      var head = text.slice(0, i);
      var code = CODE_BEFORE.exec(head);
      if (code) {
        if (code[1] === '\\' && TEXT_CODE.test(code[2])) return -1;
        i -= code[0].length;
        continue;
      }
      var ch = text.charAt(i - 1);
      if (CLOSERS.indexOf(ch) >= 0) {
        i--;
        continue;
      }
      var c = text.charCodeAt(i - 1);
      if (c >= HANGUL_FIRST && c <= HANGUL_LAST) {
        var f = (c - HANGUL_FIRST) % 28;
        return f === 0 ? 0 : f === RIEUL ? 2 : 1;
      }
      if (c >= 0x30 && c <= 0x39) return DIGIT_FINAL[c - 0x30];
      if (c >= 0xff10 && c <= 0xff19) return DIGIT_FINAL[c - 0xff10];
      if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
        var low = ch.toLowerCase();
        return low === 'l' ? 2 : low === 'm' || low === 'n' || low === 'r' ? 1 : 0;
      }
      return -1;
    }
    return -1;
  }

  function choose(form, fin) {
    var pair = PAIRS[form];
    if (pair) {
      if (form === '(으)로') return fin === 1 ? pair[0] : pair[1];
      return fin === 0 ? pair[1] : pair[0];
    }
    // (이)X
    var tail = form.slice(3);
    return fin === 0 ? tail : '이' + tail;
  }

  function fixJosa(text) {
    if (typeof text !== 'string' || text.indexOf('(') < 0) return text;
    try {
      return text.replace(FORMS, function (form, offset) {
        var fin = finalOf(text, offset);
        return fin < 0 ? form : choose(form, fin);
      });
    } catch (e) {
      return text;
    }
  }

  if (typeof String.prototype.format === 'function') {
    var _format = String.prototype.format;
    String.prototype.format = function () {
      return fixJosa(_format.apply(this, arguments));
    };
  }

  if (typeof Window_Base === 'function' && Window_Base.prototype && typeof Window_Base.prototype.convertEscapeCharacters === 'function') {
    var _convertEscapeCharacters = Window_Base.prototype.convertEscapeCharacters;
    Window_Base.prototype.convertEscapeCharacters = function () {
      return fixJosa(_convertEscapeCharacters.apply(this, arguments));
    };
  }
})();
