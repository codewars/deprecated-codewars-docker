# -*- mode: ruby -*-
# vi: set ft=ruby :

# Vagrantfile API/syntax version. Don't touch unless you know what you're doing!
VAGRANTFILE_API_VERSION = "2"

# Inline shell script to provision Vagrant
provision_script = <<-EOF
if [ ! -d /etc/puppet/modules ] ; then
  mkdir -p /etc/puppet/modules
  ruby gem puppet-module
fi
[ -d /etc/puppet/modules/apt ] || puppet module install puppetlabs-apt;
EOF

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box = "https://cloud-images.ubuntu.com/vagrant/trusty/current/trusty-server-cloudimg-i386-vagrant-disk1.box" # 32 bit
  #config.vm.box = "https://cloud-images.ubuntu.com/vagrant/trusty/current/trusty-server-cloudimg-amd64-vagrant-disk1.box" # 64 bit
  config.vm.provision "shell", inline: provision_script
  config.vm.provision :puppet do |puppet|
    puppet.manifests_path = "puppet/manifests"
    puppet.module_path = ["puppet/modules/"]
    puppet.options = ['--verbose']
  end
end
