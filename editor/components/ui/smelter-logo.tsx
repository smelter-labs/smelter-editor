import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function SmelterLogo() {
  const pathname = usePathname();
  const isKick = pathname?.toLowerCase().includes('kick');
  const href = isKick ? '/kick' : '/';

  return (
    <Link href={href}>
      <Image
        src='/smelter-logo.svg'
        alt={'Smelter logo'}
        width={162.5 / 1.2}
        height={21.25 / 1.2}
      />
    </Link>
  );
}
