import fs from 'node:fs';

console.log('Exists Z: ', fs.existsSync('Z:/'));
if (fs.existsSync('Z:/')) {
  console.log('Z:/ entries:');
  console.log(fs.readdirSync('Z:/').slice(0, 20));
  if (fs.existsSync('Z:/comp01')) {
    console.log('Z:/comp01 exists! Files count:', fs.readdirSync('Z:/comp01').length);
  }
}

console.log('Exists M: ', fs.existsSync('M:/'));
if (fs.existsSync('M:/')) {
  console.log('M:/ entries:');
  console.log(fs.readdirSync('M:/').slice(0, 20));
  if (fs.existsSync('M:/comp01')) {
    console.log('M:/comp01 exists! Files count:', fs.readdirSync('M:/comp01').length);
  }
}
