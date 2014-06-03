Exec { path => [ "/bin/", "/sbin/" , "/usr/bin/", "/usr/sbin/" ] }

# Make puppet rerun `apt-get update` every time Package is run
# http://stackoverflow.com/questions/10845864/puppet-trick-run-apt-get-update-before-installing-other-packages
include apt::update
Exec['apt_update'] -> Package <| |>

# Modules
include docker
