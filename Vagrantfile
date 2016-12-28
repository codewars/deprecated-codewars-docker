# -*- mode: ruby -*-
# vi: set ft=ruby :

# Vagrantfile API/syntax version. Don't touch unless you know what you're doing!
VAGRANTFILE_API_VERSION = "2"

# Inline shell script to provision Vagrant
provision_script = <<-EOF
echo "Deploy shipyard"
docker run -i -t --name=deploy -v /var/run/docker.sock:/docker.sock shipyard/deploy setup
docker wait deploy

# Wait an extra 15 seconds before launching the shipyard agent or you'll need to rerun it.
# This needs to be swapped out with a better waiting method
sleep 15

echo "Run shipyard agent"
docker run -i -t -d -v  /var/run/docker.sock:/docker.sock -e URL=http://10.100.150.2:8000 -p 4500:4500 shipyard/agent

echo "Ready to go"
echo "username: admin"
echo "password: shipyard"
EOF

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box = "https://cloud-images.ubuntu.com/vagrant/trusty/current/trusty-server-cloudimg-amd64-vagrant-disk1.box" # 64 bit

  config.vm.provider "virtualbox" do |v|
    v.name = "codewars_shipyard_host"
  end

  # Setting up a static network on 10.100.150.0 class C subnet
  # This is to make future expansion of the vagrant file to a small test cluster easier
  config.vm.network "private_network", ip: "10.100.150.2"
  config.vm.network "forwarded_port", guest:8000, host:8000

  # Provisioning vagrant box with docker
  config.vm.provision "docker",
    images: ["shipyard/router", "shipyard/redis", "shipyard/lb", 
             "shipyard/db","shipyard/deploy", "shipyard/agent"]

  config.vm.provision "shell", inline: provision_script
end
