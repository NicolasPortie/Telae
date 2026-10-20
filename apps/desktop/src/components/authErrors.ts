import { t } from '../i18n'
import type { AuthErrorCode } from '../shared/contracts'

/** Texto para o usuário a partir do código estável devolvido pelo servidor. */
export function authErrorMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'invalid_credentials': return t('E-mail, usuário ou senha incorretos.')
    case 'email_not_verified': return t('Confirme seu e-mail para entrar.')
    case 'invalid_code': return t('Código inválido ou expirado. Peça um novo código.')
    case 'weak_password': return t('Use uma senha com pelo menos 10 caracteres, que não seja óbvia nem contenha seu usuário.')
    case 'invalid_username': return t('O usuário deve ter de 3 a 20 caracteres: letras minúsculas, números e _.')
    case 'username_reserved': return t('Este nome de usuário não está disponível.')
    case 'username_taken': return t('Este nome de usuário já está em uso.')
    case 'invalid_email': return t('Informe um e-mail válido.')
    case 'email_taken': return t('Este e-mail já está cadastrado.')
    case 'account_locked': return t('Muitas tentativas. Tente de novo em alguns minutos.')
    case 'code_cooldown': return t('Aguarde um minuto antes de pedir outro código.')
    case 'rate_limited': return t('Muitas solicitações. Aguarde um minuto e tente novamente.')
    case 'email_unavailable': return t('Não foi possível enviar o e-mail agora. Tente de novo em instantes.')
    case 'invalid_session': return t('Sua sessão expirou. Entre novamente.')
    case 'invalid_display_name': return t('O nome deve ter entre 1 e 32 caracteres.')
    case 'network': return t('Sem conexão com o servidor. Verifique sua internet e tente novamente.')
    default: return t('Algo deu errado. Tente novamente.')
  }
}
