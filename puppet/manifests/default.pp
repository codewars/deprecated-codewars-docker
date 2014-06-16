Exec { path => [ "/bin/", "/sbin/" , "/usr/bin/", "/usr/sbin/" ] }

# Don't tamper with kernel
class { 'docker':
  manage_kernel => false,
}

include 'docker'
