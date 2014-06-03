class docker {

  package { 'docker.io':
    ensure  => installed,
  }
  ->
  exec { 'usermod -a -G docker vagrant':
  }
  ->
  file { "/etc/default/docker.io":
    mode => 644,
    owner => root,
    group => root,
    source => "puppet:///modules/docker/docker.io.upstart",
  }
  ->
  service { 'docker.io' :
    ensure     => running,
    enable     => true,
    hasrestart => true,
    hasstatus  => true,
  }

}
