var myCodeMirror;
jQuery(function() {
    myCodeMirror = CodeMirror.fromTextArea(rconConsole, {readOnly: true} );

$(document).keypress(function(e) {
  if(e.which == 13) {
     dewRcon.send(jQuery("#rconCommand").val());
        jQuery("#rconCommand").val("");
  }
});
    //TODO: Support up arrow, enter, etc
    $("#runCommand").click(function() {
        dewRcon.send(jQuery("#rconCommand").val());
        jQuery("#rconCommand").val("");
    });
});
